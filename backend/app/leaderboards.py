"""Rank only accepted result/settlement records. There is no raw-score POST API."""
from datetime import datetime, timezone, timedelta, date
from typing import Literal
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, or_, and_
from sqlalchemy.orm import Session
from .models import BoardEntry, Player, SocialPreference, SocialBlock, Result, Ledger, now
from .security import current_player
from .database import get_db
from .social import friend_ids
from .errors import ApiError
from .catalog import LINES
from .world_data import LINE_MAP, COURSES

router = APIRouter(prefix='/leaderboards', tags=['Validated leaderboards'])
PROFIT_KINDS = {'route_fares', 'route_expenses', 'tycoon_ai_fares', 'tycoon_energy', 'tycoon_wages', 'tycoon_maintenance', 'tycoon_fines', 'tycoon_breakdown', 'tycoon_scheduled_service', 'tycoon_interest', 'tycoon_toll'}


def week_key(timestamp=None):
    day = datetime.fromtimestamp(now() if timestamp is None else timestamp, timezone.utc).date()
    return (day - timedelta(days=day.weekday())).isoformat()


def record_valid_result(db, result):
    score = result.payload['route']
    line = next(l for l in LINES if l['id'] == result.route_id)
    if score['missed'] or score['served'] != len(line['stops']):
        return
    from .models import OwnedBus, BusModel
    owned = db.get(OwnedBus, result.payload.get('owned_bus_id')) if result.payload.get('owned_bus_id') else None
    model = db.get(BusModel, owned.model_id) if owned else None
    bus_class = model.category if model else 'city'
    old = db.scalar(select(BoardEntry).where(BoardEntry.source_type == 'route', BoardEntry.source_id == result.id))
    if old:
        old.map_id, old.bus_class = LINE_MAP[result.route_id], bus_class
        return
    db.add(BoardEntry(user_id=result.user_id, source_type='route', source_id=result.id, line_id=result.route_id,
                      map_id=LINE_MAP[result.route_id], bus_class=bus_class, week=week_key(result.received_at), score=score['score'], time_ms=round(result.payload['seconds'] * 1000), profit=0))


def record_profit(db, ledger, timestamp=None):
    if ledger.kind not in PROFIT_KINDS:
        return
    db.flush()
    if db.scalar(select(BoardEntry.id).where(BoardEntry.source_type == 'profit', BoardEntry.source_id == ledger.id)):
        return
    db.add(BoardEntry(user_id=ledger.user_id, source_type='profit', source_id=ledger.id, line_id='all', week=week_key(timestamp), profit=ledger.amount, score=0, time_ms=0))


def visibility(db, viewer, friends_only):
    friends = friend_ids(db, viewer.id)
    hidden = set(db.scalars(select(SocialBlock.target_id).where(SocialBlock.blocker_id == viewer.id)))
    hidden.update(db.scalars(select(SocialBlock.blocker_id).where(SocialBlock.target_id == viewer.id)))
    filters = [func.coalesce(SocialPreference.review_flag, False).is_(False), func.coalesce(SocialPreference.leaderboards_visible, True).is_(True),
               or_(SocialPreference.profile_visibility.is_(None), SocialPreference.profile_visibility == 'public',
                   and_(SocialPreference.profile_visibility == 'friends', BoardEntry.user_id.in_(friends | {viewer.id})), BoardEntry.user_id == viewer.id)]
    if hidden:
        filters.append(BoardEntry.user_id.not_in(hidden))
    if friends_only:
        filters.append(BoardEntry.user_id.in_(friends | {viewer.id}))
    return filters


@router.get('')
def board(board: Literal['score', 'time', 'race', 'profit'] = 'score', line_id: Literal['21', '36', '80', 'M1', 'M2', 'H1', 'H2'] = '21',
          period: Literal['weekly', 'all'] = 'weekly', week: str | None = None, page: int = Query(1, ge=1, le=100000),
          page_size: int = Query(20, ge=1, le=50), around_me: bool = False, friends_only: bool = False,
          map_id: Literal['northbank', 'meridian', 'coastway'] | None = None,
          bus_class: Literal['mini', 'city', 'articulated', 'coach', 'double-decker', 'electric'] | None = None,
          player: Player = Depends(current_player), db: Session = Depends(get_db)):
    selected_week = week or week_key()
    try:
        if date.fromisoformat(selected_week).weekday() != 0:
            raise ValueError()
    except ValueError:
        raise ApiError(422, 'invalid_week', 'Week must be an ISO Monday date.')
    source = 'profit' if board == 'profit' else 'race' if board == 'race' else 'route'
    filters = [BoardEntry.source_type == source, *visibility(db, player, friends_only)]
    if map_id:
        filters.append(BoardEntry.map_id == map_id)
        if board == 'race':
            line_id = COURSES[map_id]['line_id']
    if bus_class:
        filters.append(BoardEntry.bus_class == bus_class)
    if board != 'profit':
        filters.append(BoardEntry.line_id == line_id)
    if period == 'weekly':
        filters.append(BoardEntry.week == selected_week)
    if board == 'profit':
        base = select(BoardEntry.user_id.label('user_id'), Player.display_name.label('name'), Player.xp.label('xp'),
                      func.sum(BoardEntry.profit).label('value'), func.min(BoardEntry.created_at).label('tie'),
                      func.count(BoardEntry.id).label('runs')).join(Player, Player.id == BoardEntry.user_id).outerjoin(SocialPreference, SocialPreference.user_id == BoardEntry.user_id).where(*filters).group_by(BoardEntry.user_id, Player.display_name, Player.xp).subquery()
        order = [base.c.value.desc(), base.c.tie, base.c.user_id]
    else:
        value = BoardEntry.score if board == 'score' else BoardEntry.time_ms
        sort = [value.desc(), BoardEntry.time_ms, BoardEntry.created_at, BoardEntry.id] if board == 'score' else [value, BoardEntry.score.desc(), BoardEntry.created_at, BoardEntry.id]
        candidates = select(BoardEntry.user_id.label('user_id'), Player.display_name.label('name'), Player.xp.label('xp'), value.label('value'),
                            BoardEntry.created_at.label('tie'), func.row_number().over(partition_by=BoardEntry.user_id, order_by=sort).label('pick')).join(Player, Player.id == BoardEntry.user_id).outerjoin(SocialPreference, SocialPreference.user_id == BoardEntry.user_id).where(*filters).subquery()
        base = select(candidates.c.user_id, candidates.c.name, candidates.c.xp, candidates.c.value, candidates.c.tie).where(candidates.c.pick == 1).subquery()
        order = [base.c.value.desc() if board == 'score' else base.c.value, base.c.tie, base.c.user_id]
    ranked = select(base, func.row_number().over(order_by=order).label('rank')).subquery()
    total = db.scalar(select(func.count()).select_from(base))
    my_rank = db.scalar(select(ranked.c.rank).where(ranked.c.user_id == player.id))
    offset = max(0, my_rank - 1 - page_size // 2) if around_me and my_rank else (page - 1) * page_size
    rows = db.execute(select(ranked).order_by(ranked.c.rank).offset(offset).limit(page_size)).mappings().all()
    return {'board': board, 'line_id': line_id if board != 'profit' else None, 'period': period, 'week': selected_week if period == 'weekly' else None,
            'archived': period == 'weekly' and selected_week < week_key(), 'total': total, 'page': offset // page_size + 1, 'page_size': page_size, 'offset': offset, 'my_rank': my_rank,
            'unit': 'cents' if board == 'profit' else 'points' if board == 'score' else 'milliseconds',
            'items': [{'rank': r['rank'], 'player_id': r['user_id'], 'display_name': r['name'], 'level': 1 + r['xp'] // 500, 'value': r['value'], 'me': r['user_id'] == player.id} for r in rows],
            'integrity': 'Route entries are accepted idempotent results; races use server checkpoint timing. Offline route results are plausibility-checked, not cryptographic driving proof.'}


@router.get('/weeks')
def archive_weeks(board: Literal['score', 'time', 'race', 'profit'] = 'score', line_id: Literal['21', '36', '80', 'M1', 'M2', 'H1', 'H2'] = '21',
                  player: Player = Depends(current_player), db: Session = Depends(get_db)):
    source = 'profit' if board == 'profit' else 'race' if board == 'race' else 'route'
    query = select(BoardEntry.week).where(BoardEntry.source_type == source)
    if source != 'profit':
        query = query.where(BoardEntry.line_id == line_id)
    weeks = list(db.scalars(query.distinct().order_by(BoardEntry.week.desc()).limit(104)))
    current = week_key()
    return {'current': current, 'weeks': [{'week': w, 'archived': w < current} for w in sorted(set(weeks + [current]), reverse=True)]}
