from hashlib import sha256
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session
from .catalog import LINES
from .common import profile
from .database import get_db
from .errors import ApiError
from .models import Player, OwnedBus, Terminal, CompanyRoute, CloudHead, AuthSession, LoginGuard, now
from .schemas import Register, Credentials, ProfilePatch
from .security import passwords, verify_password, DUMMY_HASH, tokens, rotate, current_player, decode, COOKIE, COOKIE_PATH

router = APIRouter(tags=['Authentication and profiles'])


def guard_rows(request, db, email):
    ip = request.client.host if request.client else 'unknown'
    rows = []
    for source in (f'account:{email}', f'ip:{ip}'):
        key = sha256(source.encode()).hexdigest()
        row = db.get(LoginGuard, key)
        if row is None:
            row = LoginGuard(key=key, failures=0, window_start=now(), blocked_until=0)
            db.add(row)
        if row.blocked_until > now():
            raise ApiError(429, 'login_locked', 'Too many attempts. Try again later.', {'retry_after': row.blocked_until - now()})
        if now() - row.window_start > request.app.state.settings.login_lock_seconds:
            row.failures = 0
            row.window_start = now()
        rows.append(row)
    return rows


@router.post('/auth/register', status_code=201)
def register(data: Register, request: Request, response: Response, db: Session = Depends(get_db)):
    guard_rows(request, db, data.email)
    if db.scalar(select(Player).where(Player.email == data.email)):
        raise ApiError(409, 'account_exists', 'An account with that email already exists.')
    player = Player(email=data.email, display_name=data.display_name, password_hash=passwords.hash(data.password))
    db.add(player)
    db.flush()
    db.add(OwnedBus(user_id=player.id, model_id='cb-120'))
    db.add(Terminal(user_id=player.id, template_id='southbank', name='Southbank Terminal', capacity=5))
    db.add(CloudHead(user_id=player.id, version=0))
    for line in LINES:
        db.add(CompanyRoute(user_id=player.id, line_id=line['id'], timetable={'departure_minutes': [480, 540, 600], 'relative_stop_seconds': line['due']}, ticket_price=250))
    result = tokens(request, response, db, player)
    db.commit()
    return {**result, 'profile': profile(player)}


@router.post('/auth/login')
def login(data: Credentials, request: Request, response: Response, db: Session = Depends(get_db)):
    guards = guard_rows(request, db, data.email)
    player = db.scalar(select(Player).where(Player.email == data.email))
    valid = verify_password(data.password, player.password_hash if player else DUMMY_HASH)
    if not player or not valid:
        for index, guard in enumerate(guards):
            guard.failures += 1
            threshold = request.app.state.settings.login_attempts * (1 if index == 0 else 4)
            if guard.failures >= threshold:
                guard.blocked_until = now() + request.app.state.settings.login_lock_seconds
        db.commit()
        raise ApiError(401, 'invalid_credentials', 'Email or password is incorrect.')
    guards[0].failures = 0
    guards[0].blocked_until = 0
    if passwords.check_needs_rehash(player.password_hash):
        player.password_hash = passwords.hash(data.password)
    result = tokens(request, response, db, player)
    db.commit()
    return {**result, 'profile': profile(player)}


@router.post('/auth/refresh')
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    return rotate(request, response, db)


@router.post('/auth/logout', status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    candidate = request.cookies.get(COOKIE)
    if candidate:
        try:
            claims = decode(request, candidate, 'refresh')
            session = db.get(AuthSession, claims['sid'])
            if session:
                session.revoked = True
        except ApiError:
            pass  # Logout is idempotent even for an already-expired cookie.
    authorization = request.headers.get('authorization', '')
    if authorization.startswith('Bearer '):
        try:
            claims = decode(request, authorization[7:], 'access')
            session = db.get(AuthSession, claims['sid'])
            if session:
                session.revoked = True
        except ApiError:
            pass
    db.commit()
    response.delete_cookie(COOKIE, path=COOKIE_PATH, httponly=True, secure=request.app.state.settings.cookie_secure, samesite=request.app.state.settings.cookie_samesite)


@router.get('/profile')
def get_profile(player: Player = Depends(current_player)):
    return profile(player)


@router.patch('/profile')
def patch_profile(data: ProfilePatch, player: Player = Depends(current_player), db: Session = Depends(get_db)):
    for key, value in data.model_dump(exclude_none=True).items():
        if key == 'display_name':
            value = value.strip()
            if len(value) < 2 or any(ord(c) < 32 for c in value):
                raise ApiError(422, 'invalid_name', 'Enter a valid display name.')
        setattr(player, key, value)
    db.commit()
    return profile(player)
