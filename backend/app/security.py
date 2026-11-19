from hashlib import sha256
import hmac
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import Depends, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session
from .database import get_db
from .errors import ApiError
from .models import Player, AuthSession, RefreshToken, now, uid

passwords = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
# Unknown accounts still run Argon2 verification, avoiding a cheap timing oracle.
DUMMY_HASH = passwords.hash('not-a-real-account-password')
bearer = HTTPBearer(auto_error=False)
COOKIE = 'citybus_refresh'
COOKIE_PATH = '/api/auth'


def verify_password(value: str, hashed: str) -> bool:
    try:
        return passwords.verify(hashed, value)
    except (VerificationError, InvalidHashError):
        return False


def encode(request: Request, player: Player, family: AuthSession, kind: str, seconds: int, jti: str):
    cfg = request.app.state.settings
    return jwt.encode({'sub': player.id, 'sid': family.id, 'jti': jti, 'type': kind,
                       'iat': now(), 'exp': min(now() + seconds, family.expires_at),
                       'iss': cfg.jwt_issuer, 'aud': cfg.jwt_audience}, request.app.state.signing_key, algorithm='HS256')


def decode(request: Request, token: str, kind: str):
    try:
        cfg = request.app.state.settings
        claims = jwt.decode(token, request.app.state.signing_key, algorithms=['HS256'],
                            issuer=cfg.jwt_issuer, audience=cfg.jwt_audience,
                            options={'require': ['sub', 'sid', 'jti', 'type', 'iat', 'exp']})
        if claims['type'] != kind:
            raise ValueError('Wrong token type')
        return claims
    except (jwt.PyJWTError, ValueError, KeyError):
        raise ApiError(401, 'invalid_token', 'Session expired or invalid. Sign in again.')


def current_player(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)):
    if not credentials:
        raise ApiError(401, 'authentication_required', 'Sign in to use this endpoint.')
    claims = decode(request, credentials.credentials, 'access')
    family = db.get(AuthSession, claims['sid'])
    if not family or family.revoked or family.user_id != claims['sub'] or family.expires_at <= now():
        raise ApiError(401, 'session_revoked', 'This session has been signed out.')
    player = db.get(Player, claims['sub'])
    if not player:
        raise ApiError(401, 'invalid_token', 'Account not found.')
    return player


def tokens(request: Request, response: Response, db: Session, player: Player, family: AuthSession | None = None):
    cfg = request.app.state.settings
    if family is None:
        family = AuthSession(user_id=player.id, expires_at=now() + cfg.refresh_token_seconds)
        db.add(family)
        db.flush()
    refresh_id = uid()
    refresh = encode(request, player, family, 'refresh', cfg.refresh_token_seconds, refresh_id)
    db.add(RefreshToken(id=refresh_id, session_id=family.id, digest=sha256(refresh.encode()).hexdigest(), expires_at=family.expires_at))
    access = encode(request, player, family, 'access', cfg.access_token_seconds, uid())
    response.set_cookie(COOKIE, refresh, max_age=max(0, family.expires_at - now()), path=COOKIE_PATH,
                        httponly=True, secure=cfg.cookie_secure, samesite=cfg.cookie_samesite)
    return {'access_token': access, 'token_type': 'bearer', 'expires_in': cfg.access_token_seconds,
            'user_id': player.id}


def rotate(request: Request, response: Response, db: Session):
    token = request.cookies.get(COOKIE)
    if not token:
        raise ApiError(401, 'authentication_required', 'No refresh session is available.')
    claims = decode(request, token, 'refresh')
    # Row lock serializes refresh rotation in PostgreSQL; SQLite write requests
    # already hold BEGIN IMMEDIATE from the shared dependency.
    family = db.scalar(select(AuthSession).where(AuthSession.id == claims['sid']).with_for_update())
    record = db.get(RefreshToken, claims['jti'])
    if not family or family.revoked or family.expires_at <= now() or family.user_id != claims['sub']:
        raise ApiError(401, 'session_revoked', 'Refresh session expired or revoked.')
    if not record or record.session_id != family.id or record.used or not hmac.compare_digest(record.digest, sha256(token.encode()).hexdigest()):
        family.revoked = True
        db.commit()  # Revocation must survive the error response.
        raise ApiError(401, 'refresh_reuse', 'Refresh token reuse detected. Sign in again.')
    record.used = True
    player = db.get(Player, family.user_id)
    result = tokens(request, response, db, player, family)
    db.commit()
    return result
