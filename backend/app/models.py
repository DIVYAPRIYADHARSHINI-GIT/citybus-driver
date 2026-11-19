"""Portable SQLAlchemy 2 models. Currency is integer euro cents, time is UTC epoch seconds."""
import time
import uuid
from sqlalchemy import Boolean, Float, ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def uid() -> str:
    return str(uuid.uuid4())


def now() -> int:
    return int(time.time())


class Base(DeclarativeBase):
    pass


class Player(Base):
    __tablename__ = 'players'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(60))
    avatar: Mapped[str] = mapped_column(String(30), default='driver-green')
    xp: Mapped[int] = mapped_column(Integer, default=0)
    money: Mapped[int] = mapped_column(Integer, default=5000000)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    achievements: Mapped[list] = mapped_column(JSON, default=list)
    claimed_missions: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[int] = mapped_column(Integer, default=now)


class AuthSession(Base):
    __tablename__ = 'auth_sessions'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[int] = mapped_column(Integer, default=now)


class RefreshToken(Base):
    __tablename__ = 'refresh_tokens'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey('auth_sessions.id'), index=True)
    digest: Mapped[str] = mapped_column(String(64))
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[int] = mapped_column(Integer)


class LoginGuard(Base):
    __tablename__ = 'login_guards'
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    failures: Mapped[int] = mapped_column(Integer, default=0)
    window_start: Mapped[int] = mapped_column(Integer, default=now)
    blocked_until: Mapped[int] = mapped_column(Integer, default=0)


class BusModel(Base):
    __tablename__ = 'bus_models'
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    category: Mapped[str] = mapped_column(String(30))
    stats: Mapped[dict] = mapped_column(JSON)
    price: Mapped[int] = mapped_column(Integer)
    required_level: Mapped[int] = mapped_column(Integer, default=1)
    drive_ready: Mapped[bool] = mapped_column(Boolean, default=False)


class OwnedBus(Base):
    __tablename__ = 'owned_buses'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    model_id: Mapped[str] = mapped_column(ForeignKey('bus_models.id'))
    upgrades: Mapped[dict] = mapped_column(JSON, default=dict)
    paint: Mapped[str] = mapped_column(String(7), default='#217a6d')
    damage: Mapped[float] = mapped_column(Float, default=0)
    mileage_m: Mapped[float] = mapped_column(Float, default=0)
    fuel_l: Mapped[float] = mapped_column(Float, default=210)


class Driver(Base):
    __tablename__ = 'drivers'
    __table_args__ = (UniqueConstraint('user_id', 'template_id'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    template_id: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(60))
    skills: Mapped[dict] = mapped_column(JSON)
    salary_daily: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Terminal(Base):
    __tablename__ = 'terminals'
    __table_args__ = (UniqueConstraint('user_id', 'template_id'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    template_id: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(80))
    capacity: Mapped[int] = mapped_column(Integer)


class CompanyRoute(Base):
    __tablename__ = 'company_routes'
    __table_args__ = (UniqueConstraint('user_id', 'line_id'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    line_id: Mapped[str] = mapped_column(String(10))
    timetable: Mapped[dict] = mapped_column(JSON)
    ticket_price: Mapped[int] = mapped_column(Integer, default=250)


class Ledger(Base):
    __tablename__ = 'ledger'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    amount: Mapped[int] = mapped_column(Integer)
    reference: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[int] = mapped_column(Integer, default=now, index=True)


class Result(Base):
    __tablename__ = 'results'
    __table_args__ = (UniqueConstraint('user_id', 'run_id'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    run_id: Mapped[str] = mapped_column(String(36))
    route_id: Mapped[str] = mapped_column(String(10))
    payload: Mapped[dict] = mapped_column(JSON)
    payload_hash: Mapped[str] = mapped_column(String(64))
    xp_awarded: Mapped[int] = mapped_column(Integer)
    money_awarded: Mapped[int] = mapped_column(Integer)
    received_at: Mapped[int] = mapped_column(Integer, default=now)


class Command(Base):
    __tablename__ = 'commands'
    __table_args__ = (UniqueConstraint('user_id', 'operation_id'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    operation_id: Mapped[str] = mapped_column(String(36))
    kind: Mapped[str] = mapped_column(String(80))
    payload_hash: Mapped[str] = mapped_column(String(64))
    response: Mapped[dict] = mapped_column(JSON)
    status: Mapped[int] = mapped_column(Integer, default=200)


class CloudHead(Base):
    __tablename__ = 'cloud_heads'
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=0)
    revision_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class CloudRevision(Base):
    __tablename__ = 'cloud_revisions'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    client_id: Mapped[str] = mapped_column(String(36))
    base_version: Mapped[int] = mapped_column(Integer)
    document: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[int] = mapped_column(Integer, default=now)


class Conflict(Base):
    __tablename__ = 'sync_conflicts'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    local_revision: Mapped[str] = mapped_column(ForeignKey('cloud_revisions.id'))
    server_revision: Mapped[str] = mapped_column(ForeignKey('cloud_revisions.id'))
    server_version: Mapped[int] = mapped_column(Integer)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    choice: Mapped[str | None] = mapped_column(String(10), nullable=True)
    resolved_revision: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[int] = mapped_column(Integer, default=now)


class TycoonState(Base):
    __tablename__ = 'tycoon_states'
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    document: Mapped[dict] = mapped_column(JSON)


class FleetCondition(Base):
    __tablename__ = 'fleet_conditions'
    bus_id: Mapped[str] = mapped_column(ForeignKey('owned_buses.id'), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    wear: Mapped[dict] = mapped_column(JSON, default=dict)
    energy_units: Mapped[int] = mapped_column(Integer, default=0)
    service_due_m: Mapped[int] = mapped_column(Integer, default=0)
    reserved: Mapped[bool] = mapped_column(Boolean, default=False)


class FleetConflict(Base):
    __tablename__ = 'fleet_conflicts'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    bus_id: Mapped[str] = mapped_column(ForeignKey('owned_buses.id'))
    revision: Mapped[int] = mapped_column(Integer)
    local_document: Mapped[dict] = mapped_column(JSON)
    server_document: Mapped[dict] = mapped_column(JSON)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(Integer, default=now)


class SocialPreference(Base):
    __tablename__ = 'social_preferences'
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), primary_key=True)
    profile_visibility: Mapped[str] = mapped_column(String(12), default='public')
    online_visibility: Mapped[str] = mapped_column(String(12), default='friends')
    leaderboards_visible: Mapped[bool] = mapped_column(Boolean, default=True)
    showcase: Mapped[list] = mapped_column(JSON, default=list)
    review_flag: Mapped[bool] = mapped_column(Boolean, default=False)


class Friendship(Base):
    __tablename__ = 'friendships'
    __table_args__ = (UniqueConstraint('left_id', 'right_id'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    left_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    right_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    requester_id: Mapped[str] = mapped_column(ForeignKey('players.id'))
    state: Mapped[str] = mapped_column(String(12), default='pending')
    updated_at: Mapped[int] = mapped_column(Integer, default=now)


class SocialBlock(Base):
    __tablename__ = 'social_blocks'
    blocker_id: Mapped[str] = mapped_column(ForeignKey('players.id'), primary_key=True)
    target_id: Mapped[str] = mapped_column(ForeignKey('players.id'), primary_key=True)
    created_at: Mapped[int] = mapped_column(Integer, default=now)


class SocialMute(Base):
    __tablename__ = 'social_mutes'
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), primary_key=True)
    target_id: Mapped[str] = mapped_column(ForeignKey('players.id'), primary_key=True)


class SocialMessage(Base):
    __tablename__ = 'social_messages'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    sender_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    recipient_id: Mapped[str | None] = mapped_column(ForeignKey('players.id'), nullable=True, index=True)
    room_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    body: Mapped[str] = mapped_column(String(240))
    created_at: Mapped[int] = mapped_column(Integer, default=now, index=True)


class PlayerReport(Base):
    __tablename__ = 'player_reports'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    reporter_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    target_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    reason: Mapped[str] = mapped_column(String(20))
    description: Mapped[str] = mapped_column(String(500))
    message_id: Mapped[str | None] = mapped_column(ForeignKey('social_messages.id'), nullable=True)
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[int] = mapped_column(Integer, default=now)


class BoardEntry(Base):
    __tablename__ = 'board_entries'
    __table_args__ = (UniqueConstraint('source_type', 'source_id'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    source_type: Mapped[str] = mapped_column(String(12))
    source_id: Mapped[str] = mapped_column(String(80))
    line_id: Mapped[str] = mapped_column(String(10), default='21', index=True)
    map_id: Mapped[str] = mapped_column(String(30), default='northbank', server_default='northbank', index=True)
    bus_class: Mapped[str] = mapped_column(String(30), default='city', server_default='city', index=True)
    week: Mapped[str] = mapped_column(String(10), index=True)
    score: Mapped[int] = mapped_column(Integer, default=0)
    time_ms: Mapped[int] = mapped_column(Integer, default=0)
    profit: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[int] = mapped_column(Integer, default=now)


class RoomParticipation(Base):
    __tablename__ = 'room_participations'
    room_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), primary_key=True)
    mode: Mapped[str] = mapped_column(String(8))
    map_id: Mapped[str] = mapped_column(String(30), default='northbank', server_default='northbank')
    joined_at: Mapped[int] = mapped_column(Integer, default=now)
    left_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    distance_m: Mapped[float] = mapped_column(Float, default=0)
    valid_updates: Mapped[int] = mapped_column(Integer, default=0)
    review_flag: Mapped[bool] = mapped_column(Boolean, default=False)


class MultiplayerReward(Base):
    __tablename__ = 'multiplayer_rewards'
    __table_args__ = (UniqueConstraint('room_id', 'user_id', 'kind'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    room_id: Mapped[str] = mapped_column(String(36))
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    kind: Mapped[str] = mapped_column(String(12))
    xp: Mapped[int] = mapped_column(Integer)
    money: Mapped[int] = mapped_column(Integer)
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[int] = mapped_column(Integer, default=now)


class IntegrityEvent(Base):
    __tablename__ = 'integrity_events'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('players.id'), index=True)
    room_id: Mapped[str] = mapped_column(String(36))
    kind: Mapped[str] = mapped_column(String(40))
    details: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[int] = mapped_column(Integer, default=now)


class WorldDefinition(Base):
    __tablename__ = 'world_definitions'
    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    document: Mapped[dict] = mapped_column(JSON)
