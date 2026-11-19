from pathlib import Path
import os
import secrets
from typing import Literal
from urllib.parse import urlsplit
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ROOT / '.env'), extra='ignore')
    environment: str = 'development'
    database_url: str = f'sqlite:///{ROOT}/.local/citybus.db'
    jwt_secret: str = ''
    jwt_issuer: str = 'citybus-driver'
    jwt_audience: str = 'citybus-client'
    access_token_seconds: int = Field(600, ge=1, le=86400)
    refresh_token_seconds: int = Field(2592000, ge=60, le=7776000)
    cookie_secure: bool = False
    cookie_samesite: Literal['lax', 'strict', 'none'] = 'lax'
    cors_origins: list[str] = ['http://127.0.0.1:4173', 'http://localhost:4173', 'http://127.0.0.1:5173', 'http://localhost:5173']
    rate_limit_per_minute: int = Field(240, ge=1)
    login_attempts: int = Field(5, ge=1)
    login_lock_seconds: int = Field(300, ge=1)
    multiplayer_max_rooms: int = Field(32, ge=1, le=256)
    multiplayer_max_connections: int = Field(128, ge=2, le=2048)
    multiplayer_snapshot_hz: int = Field(15, ge=10, le=20)
    multiplayer_idle_seconds: int = Field(1800, ge=60, le=7200)

    @field_validator('cors_origins')
    @classmethod
    def explicit_origins(cls, origins):
        if not origins:
            raise ValueError('CORS_ORIGINS must contain at least one explicit browser origin')
        for origin in origins:
            parsed = urlsplit(origin)
            if parsed.scheme not in ('http', 'https') or not parsed.hostname or '*' in origin or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
                raise ValueError('CORS_ORIGINS must be exact HTTP(S) origins without paths, wildcards or trailing slashes')
            # Accessing port also validates malformed numeric ports.
            parsed.port
        return list(dict.fromkeys(origins))

    @model_validator(mode='after')
    def secure_cross_site_cookie(self):
        if self.cookie_samesite == 'none' and not self.cookie_secure:
            raise ValueError('COOKIE_SAMESITE=none requires COOKIE_SECURE=true')
        return self

    def signing_key(self) -> str:
        if self.jwt_secret:
            if len(self.jwt_secret) < 32:
                raise ValueError('JWT_SECRET must contain at least 32 characters')
            return self.jwt_secret
        if self.environment != 'development':
            raise ValueError('JWT_SECRET is required outside development')
        directory = ROOT / '.local'
        directory.mkdir(mode=0o700, exist_ok=True)
        path = directory / 'jwt-secret'
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            return path.read_text().strip()
        key = secrets.token_urlsafe(48)
        with os.fdopen(fd, 'w') as file:
            file.write(key)
        return key
