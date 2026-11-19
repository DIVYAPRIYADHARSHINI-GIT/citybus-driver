"""Single-process room actor. All mutable room state lives on one asyncio loop.
No network await occurs while producing snapshots; bounded writer queues isolate
slow peers. Database work is moved to threads and durable awards are idempotent.
"""
import asyncio
import hashlib
import json
import logging
import math
import secrets
import time
from collections import deque
from dataclasses import dataclass, field
from uuid import uuid4
from sqlalchemy import select, text
from .models import Player, AuthSession, RoomParticipation, IntegrityEvent, SocialPreference, SocialMessage, OwnedBus, MultiplayerReward, now
from .social import blocked, clean_message, message_rate, message_view
from .errors import ApiError
from .fleet_specs import BY_ID
from .multiplayer_rules import Movement, SPAWN, CHECKPOINTS, RACE_MIN_SECONDS, validate_pose, accept_pose, checkpoint_crossed, finite_number
from .multiplayer_rewards import award_race
from .world_data import BY_MAP, COURSES, LINE_MAP

log = logging.getLogger('citybus.multiplayer')


@dataclass
class Member:
    user_id: str
    name: str
    model_id: str
    paint: str
    auth_session: str
    token_hash: str
    movement: Movement = field(default_factory=Movement)
    ready: bool = False
    websocket: object = None
    queue: object = None
    writer: object = None
    last_seen: float = 0
    disconnected_at: float | None = None
    keys: dict = field(default_factory=dict)
    articulation: float = 0
    checkpoint: int = 0
    finished_ms: int | None = None
    reward: dict | None = None
    suspicious: bool = False
    strikes: deque = field(default_factory=deque)
    inbound: deque = field(default_factory=deque)
    last_client_time: float = 0
    connected_generation: str = ''
    muted: set = field(default_factory=set)
    line_id: str = '21'
    spawn: list = field(default_factory=lambda: list(SPAWN))
    loadout: dict = field(default_factory=dict)


@dataclass
class Room:
    id: str
    code: str
    host_id: str
    mode: str
    private: bool
    capacity: int
    seed: int
    created: float
    created_epoch: int
    last_activity: float
    map_id: str = 'northbank'
    members: dict = field(default_factory=dict)
    banned: set = field(default_factory=set)
    state: str = 'lobby'
    start_at: float | None = None
    finished_at: float | None = None
    results: list = field(default_factory=list)
    chat: deque = field(default_factory=lambda: deque(maxlen=50))


class RoomManager:
    def __init__(self, app, clock=time.monotonic):
        self.app = app
        self.clock = clock
        self.rooms = {}
        self.user_room = {}
        self.tickets = {}
        self.connections = 0
        self.max_observed_queue = 0
        self.dropped_snapshots = 0
        self.invalid_updates = 0
        self.tick_task = None
        self.reward_tasks = set()
        self.lock = asyncio.Lock()
        self.last_flush = self.clock()
        self.last_policy = self.clock()
        self.stopping = False

    def is_online(self, user_id):
        code = self.user_room.get(user_id)
        room = self.rooms.get(code)
        return bool(room and user_id in room.members and room.members[user_id].websocket is not None)

    def start(self):
        self.stopping = False
        self.tick_task = asyncio.create_task(self.loop())

    async def shutdown(self):
        self.stopping = True
        if self.tick_task:
            self.tick_task.cancel()
            await asyncio.gather(self.tick_task, return_exceptions=True)
        for code in list(self.rooms):
            await self.close_room(code, 'server_shutdown')
        if self.reward_tasks:
            await asyncio.wait(self.reward_tasks, timeout=8)
        self.tickets.clear()

    def create(self, user_id, mode='city', private=False, capacity=8, map_id='northbank'):
        if map_id not in BY_MAP:
            raise ApiError(422, 'unknown_map', 'Unknown map.')
        if len(self.rooms) >= self.app.state.settings.multiplayer_max_rooms:
            raise ApiError(503, 'room_capacity', 'The server room limit is reached.')
        if any(r.host_id == user_id for r in self.rooms.values()):
            raise ApiError(409, 'already_hosting', 'Close or leave your existing room first.')
        code = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(6))
        while code in self.rooms:
            code = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(6))
        room = Room(str(uuid4()), code, user_id, mode, private, capacity, secrets.randbelow(2**30), self.clock(), now(), self.clock())
        room.map_id = map_id
        self.rooms[code] = room
        return self.view(room)

    def view(self, room):
        return {'id': room.id, 'code': room.code, 'mode': room.mode, 'private': room.private, 'capacity': room.capacity, 'host_id': room.host_id,
                'state': room.state, 'seed': room.seed, 'elapsed': round(self.clock()-room.created, 3), 'collision_policy': 'ghost-player-buses',
                'snapshot_hz': self.app.state.settings.multiplayer_snapshot_hz, 'map_id': room.map_id,
                'members': [{'id': m.user_id, 'name': m.name, 'model_id': m.model_id, 'paint': m.paint, 'ready': m.ready,
                             'connected': m.websocket is not None, 'checkpoint': m.checkpoint, 'finished_ms': m.finished_ms, 'review': m.suspicious, 'line_id': m.line_id} for m in room.members.values()],
                'countdown': max(0, (room.start_at or 0)-self.clock()) if room.state == 'countdown' else 0,
                'race_elapsed': max(0, self.clock()-(room.start_at or self.clock())), 'results': room.results,
                'course': COURSES[room.map_id]}

    def policy_check(self, user_id, other_ids, model_id, auth_session):
        with self.app.state.sessions() as db:
            family = db.get(AuthSession, auth_session)
            user = db.get(Player, user_id)
            if not user or not family or family.user_id != user_id or family.revoked or family.expires_at <= now():
                raise ApiError(401, 'session_revoked', 'Sign in again before joining.')
            for other in other_ids:
                if other != user_id and blocked(db, user_id, other):
                    raise ApiError(403, 'room_unavailable', 'This room is unavailable due to a block relationship.')
            owned = db.scalar(select(OwnedBus).where(OwnedBus.user_id == user_id, OwnedBus.model_id == model_id).order_by(OwnedBus.id))
            if model_id not in BY_ID or not owned:
                raise ApiError(409, 'bus_unavailable', 'Choose an owned drive-ready bus.')
            from .models import SocialMute, FleetCondition, TycoonState
            company = db.get(TycoonState, user_id)
            if company and any(a['active'] and a['bus_id'] == owned.id for a in company.document.get('assignments', [])):
                raise ApiError(409, 'bus_assigned', 'Unassign this bus from AI service before joining multiplayer.')
            condition = db.get(FleetCondition, owned.id)
            loadout = {'id': owned.id, 'model_id': model_id, 'paint': owned.paint, 'upgrades': owned.upgrades,
                       'wear': condition.wear if condition else {'engine': 0, 'brakes': 0, 'tires': 0, 'energy': 0},
                       'energy_units': condition.energy_units if condition else round((BY_ID[model_id]['battery_kwh'] * .8 if BY_ID[model_id]['energy'] == 'electric' else owned.fuel_l) * 1000),
                       'revision': condition.revision if condition else 0,
                       'review': bool((db.get(SocialPreference, user_id) or SocialPreference()).review_flag)}
            muted = set(db.scalars(select(SocialMute.target_id).where(SocialMute.user_id == user_id)))
            return user.display_name, muted, loadout

    async def issue_ticket(self, player_id, auth_session, code, model_id, paint, resume_token=None, line_id='21'):
        code = code.upper()
        async with self.lock:
            room = self.rooms.get(code)
            if not room or player_id in room.banned:
                raise ApiError(404, 'room_unavailable', 'Room not found or unavailable.')
            if room.mode == 'race' and model_id != 'cb-120':
                raise ApiError(409, 'race_spec_bus', 'Northbank Sprint uses the equal-spec CB 120 class. Other owned models can join shared city rooms.')
            if line_id == '21' and room.map_id != 'northbank':
                line_id = COURSES[room.map_id]['line_id']
            if LINE_MAP.get(line_id) != room.map_id:
                raise ApiError(422, 'route_map_mismatch', 'Choose a route in this room map.')
            await asyncio.to_thread(self.policy_check, player_id, set(room.members) | {room.host_id}, model_id, auth_session)
            if len(self.tickets) >= self.app.state.settings.multiplayer_max_connections * 2:
                raise ApiError(429, 'ticket_limit', 'Too many pending connection attempts.')
            ticket = secrets.token_urlsafe(32)
            self.tickets[hashlib.sha256(ticket.encode()).hexdigest()] = {'user_id': player_id, 'auth_session': auth_session, 'code': code, 'model_id': model_id, 'paint': paint, 'resume_token': resume_token, 'line_id': line_id, 'expires': self.clock()+30}
            return {'ticket': ticket, 'expires_in': 30, 'websocket_path': '/api/multiplayer/ws'}

    async def attach(self, websocket, ticket):
        async with self.lock:
            data = self.tickets.pop(hashlib.sha256(ticket.encode()).hexdigest(), None)
            if not data or data['expires'] < self.clock():
                raise ApiError(401, 'invalid_ticket', 'Connection ticket expired or was already used.')
            room = self.rooms.get(data['code'])
            if not room:
                raise ApiError(404, 'room_unavailable', 'Room is closed.')
            user_id = data['user_id']
            if user_id in room.banned:
                raise ApiError(403, 'kicked', 'You cannot rejoin this room.')
            name, muted, loadout = await asyncio.to_thread(self.policy_check, user_id, set(room.members) | {room.host_id}, data['model_id'], data['auth_session'])
            if room.mode == 'race':
                loadout = {**loadout, 'upgrades': {}, 'wear': {'engine': 0, 'brakes': 0, 'tires': 0, 'energy': 0}, 'energy_units': 210000}
            if self.rooms.get(room.code) is not room:
                raise ApiError(404, 'room_unavailable', 'Room closed during connection.')
            if user_id in self.user_room and self.user_room[user_id] != room.code:
                raise ApiError(409, 'already_in_room', 'Leave your current room before joining another.')
            existing = room.members.get(user_id)
            if existing:
                resume = data.get('resume_token')
                if existing.websocket is not None:
                    raise ApiError(409, 'already_connected', 'This account is already connected to the room.')
                if not resume or not secrets.compare_digest(existing.token_hash, hashlib.sha256(resume.encode()).hexdigest()) or existing.disconnected_at is None or self.clock()-existing.disconnected_at > 60:
                    raise ApiError(403, 'invalid_resume', 'The 60-second reconnect session is unavailable.')
                member = existing
            else:
                if len(room.members) >= room.capacity:
                    raise ApiError(409, 'room_full', 'The room is full, including reserved reconnect slots.')
                if room.mode == 'race' and room.state != 'lobby':
                    raise ApiError(409, 'race_started', 'This race has already started.')
                member = Member(user_id, name, data['model_id'], data['paint'], data['auth_session'], '')
                member.loadout = loadout
                member.suspicious = loadout['review']
                member.line_id = data['line_id'] if room.mode == 'city' else COURSES[room.map_id]['line_id']
                if room.map_id != 'northbank':
                    member.movement.position = list(COURSES[room.map_id]['spawn'])
                    if member.line_id == 'M2':
                        member.movement.position = [483.5, 1.12, -576.0]
                    elif member.line_id == 'H2':
                        member.movement.position = [-234.75, 1.12, -1376.0]
                if member.line_id == '80':
                    member.movement.position = [243.5, 1.12, 118.0]
                if room.mode == 'race':
                    index = len(room.members)
                    spawn = COURSES[room.map_id]['spawn']
                    member.movement.position = [spawn[0] - (index % 2)*4, spawn[1], spawn[2] + (index // 2)*10]
                member.spawn = list(member.movement.position)
                await asyncio.to_thread(self.persist_join, room, member)
                if self.rooms.get(room.code) is not room:
                    raise ApiError(404, 'room_unavailable', 'Room closed during connection.')
                if room.mode == 'race' and room.state != 'lobby':
                    raise ApiError(409, 'race_started', 'Race started during connection. Join a new lobby.')
                room.members[user_id] = member
            resume = secrets.token_urlsafe(32)
            member.token_hash = hashlib.sha256(resume.encode()).hexdigest()
            member.auth_session = data['auth_session']
            member.muted = muted
            member.websocket = websocket
            member.queue = asyncio.Queue(maxsize=16)
            member.last_seen = self.clock()
            member.disconnected_at = None
            member.connected_generation = str(uuid4())
            self.user_room[user_id] = room.code
            room.last_activity = self.clock()
            return room, member, resume

    def persist_join(self, room, member):
        with self.app.state.sessions() as db:
            old = db.get(RoomParticipation, (room.id, member.user_id))
            if not old:
                db.add(RoomParticipation(room_id=room.id, user_id=member.user_id, mode=room.mode, map_id=room.map_id))
            db.commit()

    def emit(self, member, message, critical=False):
        if member.websocket is None or member.queue is None:
            return
        if member.queue.full():
            if not critical:
                self.dropped_snapshots += 1
                return
            try:
                member.queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
        member.queue.put_nowait(message)
        self.max_observed_queue = max(self.max_observed_queue, member.queue.qsize())

    def broadcast(self, room, message):
        for member in list(room.members.values()):
            self.emit(member, message, message.get('type') != 'snapshot')

    async def writer(self, member, generation):
        socket, queue = member.websocket, member.queue
        try:
            while member.connected_generation == generation and member.websocket is socket:
                message = await queue.get()
                await asyncio.wait_for(socket.send_json(message), timeout=3)
        except (Exception, asyncio.CancelledError):
            pass
        finally:
            if member.connected_generation == generation and member.websocket is socket:
                try:
                    await socket.close(code=1013, reason='Slow or disconnected peer')
                except Exception:
                    pass

    async def detach(self, room, member, generation):
        if member.connected_generation != generation:
            return
        member.websocket = None
        member.disconnected_at = self.clock()
        if member.writer:
            member.writer.cancel()
        member.writer = None
        member.queue = None
        await asyncio.to_thread(self.persist_members, [(room, member)], False)
        if room.code in self.rooms:
            self.broadcast(room, {'type': 'room', 'room': self.view(room)})

    def persist_members(self, pairs, left=False):
        with self.app.state.sessions() as db:
            if db.bind.dialect.name == 'sqlite':
                db.execute(text('BEGIN IMMEDIATE'))
            for room, member in pairs:
                row = db.get(RoomParticipation, (room.id, member.user_id))
                if row:
                    row.distance_m = member.movement.distance
                    row.valid_updates = member.movement.valid_updates
                    row.review_flag = member.suspicious
                    if left:
                        row.left_at = now()
            db.commit()

    async def remove_member(self, room, user_id, reason, ban=False):
        member = room.members.get(user_id)
        if not member:
            return
        if ban:
            room.banned.add(user_id)
        socket = member.websocket
        if socket:
            try:
                await socket.send_json({'type': 'left', 'reason': reason})
                await socket.close(code=1000)
            except Exception:
                pass
        if member.writer:
            member.writer.cancel()
        member.websocket = None
        member.disconnected_at = self.clock()
        await asyncio.to_thread(self.persist_members, [(room, member)], True)
        room.members.pop(user_id, None)
        self.user_room.pop(user_id, None)
        if not room.members:
            self.rooms.pop(room.code, None)
        elif user_id == room.host_id:
            room.host_id = next(iter(room.members))
        if room.mode == 'race' and room.members:
            if room.state == 'countdown' and len(room.members) < 2:
                room.state, room.start_at = 'lobby', None
                for m in room.members.values():
                    m.ready = False
            elif room.state == 'racing' and all(m.finished_ms is not None for m in room.members.values()):
                room.state, room.finished_at = 'finished', self.clock()
        if room.code in self.rooms:
            self.broadcast(room, {'type': 'room', 'room': self.view(room)})

    async def close_room(self, code, reason='host_closed'):
        room = self.rooms.get(code)
        if not room:
            return
        for user_id in list(room.members):
            await self.remove_member(room, user_id, reason)
        self.rooms.pop(code, None)

    async def apply_block(self, blocker, target):
        async with self.lock:
            for room in list(self.rooms.values()):
                if blocker in room.members and target in room.members:
                    await self.remove_member(room, target if room.host_id == blocker else blocker, 'block_relationship', ban=room.host_id == blocker)

    def record_violation(self, room, member, kind, data):
        with self.app.state.sessions() as db:
            from .multiplayer_rules import finite_number
            position = data.get('p') if isinstance(data.get('p'), list) else []
            db.add(IntegrityEvent(user_id=member.user_id, room_id=room.id, kind=kind, details={'seq': data.get('seq') if type(data.get('seq')) is int else None, 'position': [v if finite_number(v) else None for v in position[:3]], 'speed': data.get('speed') if finite_number(data.get('speed')) else None}))
            if member.suspicious:
                prefs = db.get(SocialPreference, member.user_id)
                if prefs is None:
                    prefs = SocialPreference(user_id=member.user_id)
                    db.add(prefs)
                prefs.review_flag = True
            db.commit()
        log.warning(json.dumps({'event': 'invalid_multiplayer_update', 'room_id': room.id, 'user_id': member.user_id, 'kind': kind, 'review': member.suspicious}))

    async def violation(self, room, member, reason, data):
        self.invalid_updates += 1
        member.strikes.append(self.clock())
        while member.strikes and self.clock()-member.strikes[0] > 60:
            member.strikes.popleft()
        if len(member.strikes) >= 5:
            member.suspicious = True
        if len(member.strikes) <= 10:
            await asyncio.to_thread(self.record_violation, room, member, reason, data)
        self.emit(member, {'type': 'rejected', 'reason': reason, 'review': member.suspicious, 'authoritative': {'p': member.movement.position, 'q': member.movement.rotation, 'seq': member.movement.sequence}}, True)
        if len(member.strikes) >= 10:
            await self.remove_member(room, member.user_id, 'integrity_limit', ban=True)

    async def process(self, room, member, data):
        if self.rooms.get(room.code) is not room or room.members.get(member.user_id) is not member or member.websocket is None:
            return
        current = self.clock()
        member.last_seen = current
        member.inbound.append(current)
        while member.inbound and current-member.inbound[0] > 1:
            member.inbound.popleft()
        if len(member.inbound) > 90:
            await self.remove_member(room, member.user_id, 'message_flood', ban=True)
            return
        if len(member.inbound) > 35:
            return  # bounded input budget; snapshots remain 15 Hz
        kind = data.get('type')
        if kind == 'ping':
            self.emit(member, {'type': 'pong', 'echo': data.get('client_time') if finite_number(data.get('client_time')) else None, 'server_elapsed': current-room.created}, True)
        elif kind == 'ready':
            if room.state != 'lobby':
                raise ApiError(409, 'race_started', 'Ready state cannot change after start.')
            member.ready = data.get('ready') is True
            self.broadcast(room, {'type': 'room', 'room': self.view(room)})
        elif kind == 'start':
            if member.user_id != room.host_id:
                raise ApiError(403, 'host_only', 'Only the host can start.')
            if room.mode != 'race' or room.state != 'lobby' or len(room.members) < 2 or not all(m.ready and m.websocket for m in room.members.values()):
                raise ApiError(409, 'not_ready', 'At least two connected players must all be ready.')
            room.state, room.start_at = 'countdown', current+5
            for m in room.members.values():
                m.movement = Movement(position=list(m.spawn))
                m.checkpoint = 0
                m.finished_ms = None
            self.broadcast(room, {'type': 'room', 'room': self.view(room)})
        elif kind == 'kick':
            if member.user_id != room.host_id or data.get('player_id') == member.user_id:
                raise ApiError(403, 'host_only', 'Only the host can kick another player.')
            await self.remove_member(room, data.get('player_id'), 'host_kicked', True)
        elif kind == 'close':
            if member.user_id != room.host_id:
                raise ApiError(403, 'host_only', 'Only the host can close this room.')
            await self.close_room(room.code)
        elif kind == 'leave':
            await self.remove_member(room, member.user_id, 'left_room')
        elif kind == 'chat':
            message = await asyncio.to_thread(self.chat_message, room, member, data, list(room.members))
            if room.members.get(member.user_id) is not member:
                return
            if message.pop('_duplicate', False):
                self.emit(member, {'type': 'chat', 'message': message}, True)
                return
            room.chat.append(message)
            for recipient in room.members.values():
                if member.user_id not in recipient.muted:
                    self.emit(recipient, {'type': 'chat', 'message': message}, True)
        elif kind == 'pose':
            reason = validate_pose(member.movement, data, current, BY_ID[member.model_id]['max_speed_mps']+5, BY_MAP[room.map_id]['bounds'] if room.map_id != 'northbank' else (-760,-760,1520,1520))
            if reason == 'too_frequent':
                return
            if not reason and room.mode == 'race' and room.state in ('lobby', 'countdown') and math.dist(data['p'], member.spawn) > 2.5:
                reason = 'false_start'
            if reason:
                await self.violation(room, member, reason, data)
                return
            old = accept_pose(member.movement, data, current)
            member.keys = data.get('keys', {})
            member.articulation = data.get('articulation', 0)
            member.last_client_time = data.get('client_time', 0) if finite_number(data.get('client_time')) else 0
            room.last_activity = current
            if room.mode == 'race' and room.state == 'racing' and member.finished_ms is None:
                course = COURSES[room.map_id]
                if checkpoint_crossed(old, member.movement.position, member.checkpoint, course['checkpoints']):
                    member.checkpoint += 1
                    self.emit(member, {'type': 'checkpoint', 'checkpoint': member.checkpoint}, True)
                    if member.checkpoint == len(course['checkpoints']):
                        elapsed = current-room.start_at
                        if elapsed < course['minimum_seconds'] or member.movement.distance < course['minimum_meters']:
                            await self.violation(room, member, 'impossible_race_finish', data)
                            member.suspicious = True
                        member.finished_ms = round(elapsed*1000)
                        result = {'player_id': member.user_id, 'name': member.name, 'time_ms': member.finished_ms, 'position': len(room.results)+1, 'review': member.suspicious, 'reward': {'pending': True}}
                        room.results.append(result)
                        task = asyncio.create_task(self.finish_race(room, member, result))
                        self.reward_tasks.add(task)
                        task.add_done_callback(self.reward_tasks.discard)
                        if all(m.finished_ms is not None for m in room.members.values()):
                            room.state, room.finished_at = 'finished', current
                        self.broadcast(room, {'type': 'room', 'room': self.view(room)})
        else:
            raise ApiError(422, 'unknown_message', 'Unknown multiplayer message type.')

    async def finish_race(self, room, member, result):
        for attempt in range(3):
            try:
                reward = await asyncio.to_thread(award_race, self.app.state.sessions, room.id, member.user_id, member.finished_ms, result['position'], member.checkpoint, member.suspicious, room.map_id, BY_ID[member.model_id]['category'])
                member.reward = result['reward'] = reward
                self.broadcast(room, {'type': 'race_result', 'result': result})
                return
            except Exception:
                log.exception('race_reward_retry', extra={'room_id': room.id})
                await asyncio.sleep(2**attempt)
        result['reward'] = {'credited': False, 'reason': 'database_unavailable'}
        self.broadcast(room, {'type': 'race_result', 'result': result})

    def chat_message(self, room, member, data, recipient_ids):
        from uuid import UUID
        try:
            message_id = str(UUID(str(data.get('message_id'))))
        except ValueError:
            raise ApiError(422, 'invalid_message_id', 'Chat requires a UUID message id.')
        text_value = data.get('text')
        if not isinstance(text_value, str):
            raise ApiError(422, 'invalid_message', 'Chat text must be a string.')
        text_value = clean_message(text_value)
        with self.app.state.sessions() as db:
            row = db.get(SocialMessage, message_id)
            if row:
                if row.sender_id != member.user_id or row.room_id != room.id or row.body != text_value:
                    raise ApiError(409, 'message_id_conflict', 'Message id already used.')
                return {**message_view(db, row), '_duplicate': True}
            message_rate(db, member.user_id)
            for other in recipient_ids:
                if other != member.user_id and blocked(db, member.user_id, other):
                    raise ApiError(403, 'blocked', 'Chat unavailable due to a block.')
            row = SocialMessage(id=message_id, sender_id=member.user_id, room_id=room.id, body=text_value)
            db.add(row)
            db.commit()
            return message_view(db, row)

    def policies(self, members):
        from .models import SocialMute
        with self.app.state.sessions() as db:
            muted = {}
            revoked = set()
            for user_id, session_id in members:
                muted[user_id] = set(db.scalars(select(SocialMute.target_id).where(SocialMute.user_id == user_id)))
                family = db.get(AuthSession, session_id)
                if not family or family.revoked or family.expires_at <= now():
                    revoked.add(user_id)
            return muted, revoked

    async def tick(self):
        current = self.clock()
        for key, ticket in list(self.tickets.items()):
            if ticket['expires'] < current:
                self.tickets.pop(key, None)
        for room in list(self.rooms.values()):
            if current-room.last_activity > self.app.state.settings.multiplayer_idle_seconds or current-room.created > 7200 or (not room.members and current-room.created > 120) or (room.finished_at and current-room.finished_at > 180):
                await self.close_room(room.code, 'room_expired')
                continue
            if room.state == 'countdown' and current >= room.start_at:
                room.state = 'racing'
                self.broadcast(room, {'type': 'room', 'room': self.view(room)})
            for m in list(room.members.values()):
                if m.disconnected_at is not None and current-m.disconnected_at > 60:
                    await self.remove_member(room, m.user_id, 'reconnect_expired')
                elif m.websocket is not None and current-m.last_seen > 15:
                    try:
                        await m.websocket.close(code=1001, reason='heartbeat_timeout')
                    except Exception:
                        pass
            if room.code not in self.rooms:
                continue
            states = [{'id': m.user_id, 'name': m.name, 'model_id': m.model_id, 'paint': m.paint, 'p': m.movement.position, 'q': m.movement.rotation,
                       'speed': m.movement.speed, 'seq': m.movement.sequence, 'keys': m.keys, 'articulation': m.articulation,
                       'connected': m.websocket is not None, 'checkpoint': m.checkpoint, 'finished_ms': m.finished_ms, 'client_time': m.last_client_time} for m in room.members.values()]
            self.broadcast(room, {'type': 'snapshot', 'elapsed': current-room.created, 'phase': room.state,
                                  'race_elapsed': max(0, current-(room.start_at or current)), 'countdown': max(0, (room.start_at or 0)-current) if room.state == 'countdown' else 0,
                                  'players': states})
        if current-self.last_flush >= 5:
            self.last_flush = current
            pairs = [(r, m) for r in list(self.rooms.values()) for m in list(r.members.values())]
            if pairs:
                await asyncio.to_thread(self.persist_members, pairs, False)
        if current-self.last_policy >= 3:
            self.last_policy = current
            members = [(m.user_id, m.auth_session) for r in list(self.rooms.values()) for m in list(r.members.values())]
            muted, revoked = await asyncio.to_thread(self.policies, members)
            for room in list(self.rooms.values()):
                for m in list(room.members.values()):
                    m.muted = muted.get(m.user_id, set())
                    if m.user_id in revoked:
                        await self.remove_member(room, m.user_id, 'session_revoked')

    async def loop(self):
        interval = 1/self.app.state.settings.multiplayer_snapshot_hz
        while not self.stopping:
            start = self.clock()
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception('room_tick_failed')
            await asyncio.sleep(max(.005, interval-(self.clock()-start)))
