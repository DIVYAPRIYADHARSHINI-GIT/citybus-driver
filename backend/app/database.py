from pathlib import Path
from fastapi import Request
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from .config import ROOT


def engine_for(url: str):
    parsed = make_url(url)
    if parsed.drivername in ('postgres', 'postgresql'):
        parsed = parsed.set(drivername='postgresql+psycopg')
    sqlite = parsed.get_backend_name() == 'sqlite'
    if sqlite and parsed.database and parsed.database != ':memory:':
        path = Path(parsed.database)
        if not path.is_absolute():
            path = ROOT / path
        path.parent.mkdir(parents=True, exist_ok=True)
        parsed = parsed.set(database=str(path))
    engine = create_engine(parsed, pool_pre_ping=True, connect_args={'check_same_thread': False, 'timeout': 30} if sqlite else {})
    if sqlite:
        @event.listens_for(engine, 'connect')
        def sqlite_settings(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')
            connection.execute('PRAGMA journal_mode=WAL')
    return engine


def factory_for(engine):
    return sessionmaker(bind=engine, expire_on_commit=False)


def get_db(request: Request):
    with request.app.state.sessions() as db:
        # SQLite lacks SELECT FOR UPDATE. Reserve its write lock before auth's
        # initial reads, so retries/concurrent submissions cannot double-credit.
        if db.bind.dialect.name == 'sqlite' and request.method not in ('GET', 'HEAD', 'OPTIONS'):
            db.execute(text('BEGIN IMMEDIATE'))
        try:
            yield db
        except BaseException:
            db.rollback()
            raise
