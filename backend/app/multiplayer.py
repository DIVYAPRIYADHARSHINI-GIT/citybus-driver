import asyncio
import json
import re
from typing import Literal
from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from .schemas import StrictModel
from .models import Player, SocialBlock, MultiplayerReward
from .security import current_player, decode
from .database import get_db
from .errors import ApiError

router = APIRouter(prefix='/multiplayer', tags=['Optional multiplayer'])


class RoomCreate(StrictModel):
    map_id: Literal['northbank', 'meridian', 'coastway'] = 'northbank'
    mode: Literal['city', 'race'] = 'city'
    private: bool = False
    capacity: int = Field(default=8, ge=2, le=8)


class TicketRequest(StrictModel):
    code: str = Field(min_length=6, max_length=6, pattern=r'^[A-Za-z2-9]{6}$')
    model_id: str = Field(default='cb-120', max_length=40)
    paint: str = Field(default='#217a6d', pattern=r'^#[a-fA-F0-9]{6}$')
    resume_token: str | None = Field(default=None, min_length=20, max_length=100)
    line_id: Literal['21', '36', '80', 'M1', 'M2', 'H1', 'H2'] = '21'


def blocked_ids(db, player_id):
    result = set(db.scalars(select(SocialBlock.target_id).where(SocialBlock.blocker_id == player_id)))
    result.update(db.scalars(select(SocialBlock.blocker_id).where(SocialBlock.target_id == player_id)))
    return result


@router.get('/rooms')
async def rooms(request: Request, mode: Literal['city', 'race'] = 'city', player: Player = Depends(current_player), db: Session = Depends(get_db)):
    manager = request.app.state.rooms
    blocked = blocked_ids(db, player.id)
    items = []
    for room in list(manager.rooms.values()):
        if room.private or room.mode != mode or room.host_id in blocked or set(room.members) & blocked or room.state not in ('lobby',):
            continue
        item = {'code': room.code, 'mode': room.mode, 'private': False, 'capacity': room.capacity, 'member_count': len(room.members), 'members': [], 'state': room.state}
        items.append(item)
    return {'items': items[:32], 'collision_policy': 'ghost-player-buses', 'process_scope': 'single-process'}


@router.post('/rooms', status_code=201)
async def create_room(data: RoomCreate, request: Request, player: Player = Depends(current_player)):
    return request.app.state.rooms.create(player.id, data.mode, data.private, data.capacity, data.map_id)


@router.post('/quick-match')
async def quick_match(data: RoomCreate, request: Request, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    manager = request.app.state.rooms
    blocked = blocked_ids(db, player.id)
    existing = manager.user_room.get(player.id)
    if existing and existing in manager.rooms:
        return manager.view(manager.rooms[existing])
    for room in list(manager.rooms.values()):
        if not room.private and room.mode == data.mode and room.map_id == data.map_id and room.state == 'lobby' and len(room.members) < room.capacity and room.host_id not in blocked and not (set(room.members) & blocked) and player.id not in room.banned:
            return {'code': room.code, 'mode': room.mode, 'capacity': room.capacity, 'member_count': len(room.members)}
    return manager.create(player.id, data.mode, False, data.capacity, data.map_id)


@router.post('/ticket')
async def connection_ticket(data: TicketRequest, request: Request, player: Player = Depends(current_player)):
    claims = decode(request, request.headers['authorization'][7:], 'access')
    return await request.app.state.rooms.issue_ticket(player.id, claims['sid'], data.code, data.model_id, data.paint, data.resume_token, data.line_id)


@router.delete('/rooms/{code}', status_code=204)
async def close_room(code: str, request: Request, player: Player = Depends(current_player)):
    manager = request.app.state.rooms
    room = manager.rooms.get(code.upper())
    if room and room.host_id != player.id:
        raise ApiError(403, 'host_only', 'Only the host can close a room.')
    if room:
        await manager.close_room(room.code)


@router.get('/rewards')
def rewards(player: Player = Depends(current_player), db: Session = Depends(get_db)):
    return {'items': [{'id': r.id, 'room_id': r.room_id, 'kind': r.kind, 'xp': r.xp, 'money': r.money, 'result': r.result, 'created_at': r.created_at} for r in db.scalars(select(MultiplayerReward).where(MultiplayerReward.user_id == player.id).order_by(MultiplayerReward.created_at.desc()).limit(50))]}


@router.websocket('/ws')
async def websocket_room(websocket: WebSocket):
    manager = websocket.app.state.rooms
    cfg = websocket.app.state.settings
    if websocket.headers.get('origin') not in cfg.cors_origins:
        await websocket.close(code=1008, reason='origin_not_allowed')
        return
    if manager.connections >= cfg.multiplayer_max_connections or manager.stopping:
        await websocket.close(code=1013, reason='connection_capacity')
        return
    manager.connections += 1
    room = member = generation = None
    try:
        await websocket.accept()
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=5)
        if len(raw.encode()) > 4096:
            raise ApiError(413, 'message_too_large', 'Handshake exceeds size limit.')
        data = json.loads(raw)
        if not isinstance(data, dict) or data.get('type') != 'join' or not isinstance(data.get('ticket'), str):
            raise ApiError(401, 'ticket_required', 'Authenticate with a short-lived connection ticket.')
        room, member, resume_token = await manager.attach(websocket, data['ticket'])
        generation = member.connected_generation
        await websocket.send_json({'type': 'welcome', 'self_id': member.user_id, 'room': manager.view(room),
                                   'resume_token': resume_token, 'resume_seconds': 60,
                                   'pose': {'p': member.movement.position, 'q': member.movement.rotation, 'speed': member.movement.speed, 'seq': member.movement.sequence, 'loadout': member.loadout},
                                   'chat': [m for m in room.chat if m['sender_id'] not in member.muted]})
        member.writer = asyncio.create_task(manager.writer(member, generation))
        manager.broadcast(room, {'type': 'room', 'room': manager.view(room)})
        while member.websocket is websocket and room.code in manager.rooms:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=20)
            if len(raw.encode()) > 4096:
                await websocket.close(code=1009, reason='message_too_large')
                break
            try:
                data = json.loads(raw)
                if not isinstance(data, dict):
                    raise ApiError(422, 'invalid_message', 'Expected a JSON object.')
                await manager.process(room, member, data)
            except (ValueError, TypeError):
                manager.emit(member, {'type': 'error', 'code': 'invalid_json', 'message': 'Invalid JSON message.'}, True)
            except ApiError as error:
                manager.emit(member, {'type': 'error', 'code': error.code, 'message': error.message, 'details': error.details}, True)
    except ApiError as error:
        try:
            await websocket.send_json({'type': 'error', 'code': error.code, 'message': error.message})
            await websocket.close(code=1008)
        except Exception:
            pass
    except asyncio.TimeoutError:
        try:
            await websocket.close(code=1001, reason='heartbeat_or_handshake_timeout')
        except Exception:
            pass
    except (ValueError, TypeError, KeyError):
        try:
            await websocket.close(code=1003, reason='invalid_message_format')
        except Exception:
            pass
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        if member and room:
            await manager.detach(room, member, generation)
        manager.connections = max(0, manager.connections-1)
