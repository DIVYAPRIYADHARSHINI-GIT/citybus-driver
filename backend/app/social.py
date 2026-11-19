"""Authenticated social graph; privacy and blocking are enforced server-side."""
import re
import unicodedata
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field
from sqlalchemy import select, or_, and_, func
from sqlalchemy.orm import Session
from .database import get_db
from .models import Player, Friendship, SocialBlock, SocialMute, SocialPreference, SocialMessage, PlayerReport, RoomParticipation, OwnedBus, BusModel, Result, now
from .schemas import StrictModel
from .security import current_player
from .errors import ApiError

router = APIRouter(prefix='/social', tags=['Friends, profiles and safety'])


def relationship_lock(db, a, b):
    # Stable ordering prevents opposite-direction request/block deadlocks on PG.
    list(db.scalars(select(Player).where(Player.id.in_(sorted([a, b]))).order_by(Player.id).with_for_update()))


class Target(StrictModel):
    player_id: UUID


class FriendAction(StrictModel):
    action: Literal['accept', 'decline', 'cancel', 'remove']


class Privacy(StrictModel):
    profile_visibility: Literal['public', 'friends', 'private']
    online_visibility: Literal['public', 'friends', 'hidden']
    leaderboards_visible: bool = True
    showcase: list[UUID] = Field(default_factory=list, max_length=6)


class MessageInput(StrictModel):
    message_id: UUID
    text: str = Field(min_length=1, max_length=240)


class ReportInput(StrictModel):
    report_id: UUID
    player_id: UUID
    reason: Literal['harassment', 'cheating', 'spam', 'other']
    description: str = Field(default='', max_length=500)
    message_id: UUID | None = None


def preference(db, id_, create=False):
    row = db.get(SocialPreference, id_)
    if row is None:
        row = SocialPreference(user_id=id_, profile_visibility='public', online_visibility='friends', leaderboards_visible=True, showcase=[], review_flag=False)
        if create:
            db.add(row)
            db.flush()
    return row


def blocked(db, a, b):
    return bool(db.get(SocialBlock, (a, b)) or db.get(SocialBlock, (b, a)))


def pair(db, a, b):
    left, right = sorted([a, b])
    return db.scalar(select(Friendship).where(Friendship.left_id == left, Friendship.right_id == right))


def are_friends(db, a, b):
    row = pair(db, a, b)
    return bool(row and row.state == 'accepted' and not blocked(db, a, b))


def friend_ids(db, user_id):
    rows = db.scalars(select(Friendship).where(or_(Friendship.left_id == user_id, Friendship.right_id == user_id), Friendship.state == 'accepted'))
    return {r.right_id if r.left_id == user_id else r.left_id for r in rows}


def unavailable(db, me, target):
    user = db.get(Player, target)
    if not user or target == me or blocked(db, me, target):
        raise ApiError(404, 'player_unavailable', 'That player is unavailable.')
    return user


def clean_message(text):
    text = unicodedata.normalize('NFKC', text).strip()
    if not 1 <= len(text) <= 240 or any(unicodedata.category(c).startswith('C') for c in text):
        raise ApiError(422, 'invalid_message', 'Messages must contain 1–240 characters without control characters.')
    return re.sub(r'\b(fuck|shit|bitch|asshole)\b', lambda m: '*' * len(m.group()), text, flags=re.IGNORECASE)


def message_rate(db, sender):
    recent = db.scalar(select(func.count()).select_from(SocialMessage).where(SocialMessage.sender_id == sender, SocialMessage.created_at > now() - 10))
    if recent >= 5:
        raise ApiError(429, 'chat_rate_limit', 'Wait before sending more messages.', {'retry_after': 10})


def message_view(db, row):
    sender = db.get(Player, row.sender_id)
    return {'id': row.id, 'sender_id': row.sender_id, 'name': sender.display_name if sender else 'Driver', 'text': row.body, 'created_at': row.created_at}


def online_status(request, db, viewer, target):
    prefs = preference(db, target)
    allowed = target == viewer or prefs.online_visibility == 'public' or (prefs.online_visibility == 'friends' and are_friends(db, viewer, target))
    return request.app.state.rooms.is_online(target) if allowed else None


@router.get('/privacy')
def get_privacy(player: Player = Depends(current_player), db: Session = Depends(get_db)):
    prefs = preference(db, player.id)
    return {k: getattr(prefs, k) for k in ('profile_visibility', 'online_visibility', 'leaderboards_visible', 'showcase')}


@router.put('/privacy')
def update_privacy(data: Privacy, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    for id_ in data.showcase:
        bus = db.get(OwnedBus, str(id_))
        if not bus or bus.user_id != player.id:
            raise ApiError(422, 'invalid_showcase', 'Showcase buses must belong to this account.')
    prefs = preference(db, player.id, True)
    for key, value in data.model_dump(mode='json').items():
        setattr(prefs, key, value)
    db.commit()
    return get_privacy(player, db)


@router.get('/players')
def search_players(request: Request, q: str = Query('', max_length=60), limit: int = Query(20, ge=1, le=50), player: Player = Depends(current_player), db: Session = Depends(get_db)):
    # Deliberately bounded search and no email lookup/enumeration.
    query = select(Player).where(Player.id != player.id)
    if q:
        escaped = q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        query = query.where(Player.display_name.ilike(f'%{escaped}%', escape='\\'))
    items = []
    for target in db.scalars(query.order_by(Player.display_name, Player.id).limit(200)):
        prefs = preference(db, target.id)
        if blocked(db, player.id, target.id) or prefs.profile_visibility == 'private' or (prefs.profile_visibility == 'friends' and not are_friends(db, player.id, target.id)):
            continue
        items.append({'id': target.id, 'display_name': target.display_name, 'level': 1 + target.xp // 500, 'avatar': target.avatar, 'online': online_status(request, db, player.id, target.id)})
        if len(items) >= limit:
            break
    return {'items': items}


@router.get('/players/{player_id}')
def public_profile(player_id: str, request: Request, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    target = db.get(Player, player_id)
    if not target or blocked(db, player.id, player_id):
        raise ApiError(404, 'player_unavailable', 'Profile unavailable.')
    prefs = preference(db, player_id)
    if player.id != player_id and (prefs.profile_visibility == 'private' or (prefs.profile_visibility == 'friends' and not are_friends(db, player.id, player_id))):
        raise ApiError(404, 'profile_private', 'This profile is not visible to you.')
    count = db.scalar(select(func.count()).select_from(Result).where(Result.user_id == player_id))
    meters = db.scalar(select(func.sum(Result.payload['meters'].as_float())).where(Result.user_id == player_id)) or 0
    query = select(OwnedBus).where(OwnedBus.user_id == player_id)
    if prefs.showcase:
        query = query.where(OwnedBus.id.in_(prefs.showcase))
    showcase = []
    for bus in db.scalars(query.order_by(OwnedBus.id).limit(6)):
        model = db.get(BusModel, bus.model_id)
        showcase.append({'model_id': bus.model_id, 'name': model.name, 'category': model.category, 'paint': bus.paint})
    return {'id': target.id, 'display_name': target.display_name, 'avatar': target.avatar, 'level': 1 + target.xp // 500,
            'stats': {'completed_results': count, 'meters': round(meters)}, 'showcase': showcase,
            'online': online_status(request, db, player.id, target.id), 'friend': are_friends(db, player.id, target.id)}


@router.get('/friends')
def friends(request: Request, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    items = []
    for row in db.scalars(select(Friendship).where(or_(Friendship.left_id == player.id, Friendship.right_id == player.id), Friendship.state.in_(['pending', 'accepted'])).order_by(Friendship.updated_at.desc())):
        target_id = row.right_id if row.left_id == player.id else row.left_id
        if blocked(db, player.id, target_id):
            continue
        target = db.get(Player, target_id)
        items.append({'id': row.id, 'player_id': target_id, 'display_name': target.display_name, 'level': 1 + target.xp // 500,
                      'state': row.state, 'direction': 'outgoing' if row.requester_id == player.id else 'incoming',
                      'online': online_status(request, db, player.id, target_id)})
    return {'items': items, 'muted': list(db.scalars(select(SocialMute.target_id).where(SocialMute.user_id == player.id))),
            'blocked': list(db.scalars(select(SocialBlock.target_id).where(SocialBlock.blocker_id == player.id)))}


@router.post('/requests')
def send_request(data: Target, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    relationship_lock(db, player.id, str(data.player_id))
    target = unavailable(db, player.id, str(data.player_id))
    if preference(db, target.id).profile_visibility == 'private':
        raise ApiError(404, 'player_unavailable', 'That player is unavailable for requests.')
    row = pair(db, player.id, target.id)
    if row and row.state in ('pending', 'accepted'):
        return {'id': row.id, 'state': row.state}
    if row and now() - row.updated_at < 60:
        raise ApiError(429, 'request_cooldown', 'Wait before sending another request.', {'retry_after': 60})
    count = db.scalar(select(func.count()).select_from(Friendship).where(Friendship.requester_id == player.id, Friendship.updated_at > now() - 3600))
    if count >= 20:
        raise ApiError(429, 'request_limit', 'Friend-request limit reached.', {'retry_after': 3600})
    if row:
        row.state, row.requester_id, row.updated_at = 'pending', player.id, now()
    else:
        left, right = sorted([player.id, target.id])
        row = Friendship(left_id=left, right_id=right, requester_id=player.id, state='pending')
        db.add(row)
    db.commit()
    return {'id': row.id, 'state': row.state}


@router.post('/requests/{request_id}')
def act_request(request_id: str, data: FriendAction, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    row = db.get(Friendship, request_id)
    if not row or player.id not in (row.left_id, row.right_id):
        raise ApiError(404, 'not_found', 'Friend request not found.')
    target = row.right_id if row.left_id == player.id else row.left_id
    relationship_lock(db, player.id, target)
    db.refresh(row)
    if blocked(db, player.id, target):
        raise ApiError(403, 'blocked', 'This relationship is blocked.')
    if data.action == 'remove' and row.state == 'accepted':
        row.state = 'removed'
    elif data.action == 'accept' and row.state == 'accepted':
        return {'id': row.id, 'state': row.state}
    elif row.state == 'pending' and ((data.action == 'cancel' and row.requester_id == player.id) or (data.action in ('accept', 'decline') and row.requester_id != player.id)):
        row.state = {'accept': 'accepted', 'decline': 'declined', 'cancel': 'cancelled'}[data.action]
    else:
        raise ApiError(409, 'invalid_friend_action', 'This request cannot be changed that way.')
    row.updated_at = now()
    db.commit()
    return {'id': row.id, 'state': row.state}


@router.put('/blocks/{player_id}')
async def block_player(player_id: str, request: Request, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    if player_id == player.id or not db.get(Player, player_id):
        raise ApiError(404, 'player_unavailable', 'Player unavailable.')
    relationship_lock(db, player.id, player_id)
    if not db.get(SocialBlock, (player.id, player_id)):
        db.add(SocialBlock(blocker_id=player.id, target_id=player_id))
    row = pair(db, player.id, player_id)
    if row:
        row.state = 'removed'
    db.commit()
    await request.app.state.rooms.apply_block(player.id, player_id)
    return {'blocked': True}


@router.delete('/blocks/{player_id}', status_code=204)
def unblock_player(player_id: str, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    row = db.get(SocialBlock, (player.id, player_id))
    if row:
        db.delete(row)
    db.commit()


@router.put('/mutes/{player_id}')
def mute_player(player_id: str, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    if not db.get(Player, player_id) or player_id == player.id:
        raise ApiError(404, 'player_unavailable', 'Player unavailable.')
    if not db.get(SocialMute, (player.id, player_id)):
        db.add(SocialMute(user_id=player.id, target_id=player_id))
    db.commit()
    return {'muted': True}


@router.delete('/mutes/{player_id}', status_code=204)
def unmute_player(player_id: str, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    row = db.get(SocialMute, (player.id, player_id))
    if row:
        db.delete(row)
    db.commit()


@router.post('/messages/{player_id}')
def direct_message(player_id: str, data: MessageInput, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    relationship_lock(db, player.id, player_id)
    unavailable(db, player.id, player_id)
    if not are_friends(db, player.id, player_id):
        raise ApiError(403, 'friends_only', 'Direct messages are available only between accepted friends.')
    existing = db.get(SocialMessage, str(data.message_id))
    text = clean_message(data.text)
    if existing:
        if existing.sender_id != player.id or existing.recipient_id != player_id or existing.body != text:
            raise ApiError(409, 'message_id_conflict', 'Message id was already used.')
        return message_view(db, existing)
    if db.get(SocialMute, (player_id, player.id)):
        raise ApiError(403, 'messaging_unavailable', 'This conversation is unavailable.')
    message_rate(db, player.id)
    row = SocialMessage(id=str(data.message_id), sender_id=player.id, recipient_id=player_id, body=text)
    db.add(row)
    db.commit()
    return message_view(db, row)


@router.get('/messages/{player_id}')
def message_history(player_id: str, before: int | None = None, limit: int = Query(30, ge=1, le=50), player: Player = Depends(current_player), db: Session = Depends(get_db)):
    unavailable(db, player.id, player_id)
    if not are_friends(db, player.id, player_id) or db.get(SocialMute, (player.id, player_id)):
        return {'items': []}
    query = select(SocialMessage).where(or_(and_(SocialMessage.sender_id == player.id, SocialMessage.recipient_id == player_id), and_(SocialMessage.sender_id == player_id, SocialMessage.recipient_id == player.id)))
    if before is not None:
        query = query.where(SocialMessage.created_at < before)
    rows = list(db.scalars(query.order_by(SocialMessage.created_at.desc(), SocialMessage.id).limit(limit)))
    return {'items': [message_view(db, row) for row in reversed(rows)]}


@router.post('/reports')
def report_player(data: ReportInput, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    if str(data.player_id) == player.id or not db.get(Player, str(data.player_id)):
        raise ApiError(404, 'player_unavailable', 'Player unavailable.')
    old = db.get(PlayerReport, str(data.report_id))
    if old:
        if old.reporter_id != player.id:
            raise ApiError(409, 'report_id_conflict', 'Report id already used.')
        return {'id': old.id, 'status': 'queued_for_review'}
    if db.scalar(select(func.count()).select_from(PlayerReport).where(PlayerReport.reporter_id == player.id, PlayerReport.created_at > now() - 3600)) >= 10:
        raise ApiError(429, 'report_limit', 'Report limit reached.', {'retry_after': 3600})
    evidence = {}
    if data.message_id:
        message = db.get(SocialMessage, str(data.message_id))
        if not message or message.sender_id != str(data.player_id) or (message.recipient_id and player.id not in (message.sender_id, message.recipient_id)) or (message.room_id and not db.get(RoomParticipation, (message.room_id, player.id))):
            raise ApiError(404, 'message_unavailable', 'Message unavailable for this report.')
        evidence = {'body': message.body, 'sender_id': message.sender_id, 'room_id': message.room_id}
    row = PlayerReport(id=str(data.report_id), reporter_id=player.id, target_id=str(data.player_id), reason=data.reason, description=data.description, message_id=str(data.message_id) if data.message_id else None, evidence=evidence)
    db.add(row)
    db.commit()
    return {'id': row.id, 'status': 'queued_for_review'}
