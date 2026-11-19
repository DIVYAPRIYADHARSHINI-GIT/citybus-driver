from pathlib import Path
import os
from uuid import uuid4
from sqlalchemy import text
from sqlalchemy.engine import make_url
import pytest
from alembic.config import Config
from alembic import command
from fastapi.testclient import TestClient
from app.config import ROOT, Settings
from app.main import create_app
from app.seed import seed
from app.database import engine_for


@pytest.fixture
def app(tmp_path):
    postgres = os.environ.get('CITYBUS_TEST_DATABASE_URL')
    admin_engine = None
    schema = None
    if postgres:
        admin_engine = engine_for(postgres)
        schema = 'test_' + uuid4().hex
        with admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        parsed = make_url(postgres)
        url = parsed.set(query={**parsed.query, 'options': f'-csearch_path={schema}'}).render_as_string(hide_password=False)
    else:
        url = f'sqlite:///{tmp_path}/test.db'
    cfg = Config(str(ROOT / 'alembic.ini'))
    cfg.attributes['database_url'] = url
    command.upgrade(cfg, 'head')
    settings = Settings(_env_file=None, environment='test', database_url=url, jwt_secret='test-only-signing-secret-not-for-production-12345', cookie_secure=True, rate_limit_per_minute=10000)
    app = create_app(settings)
    with app.state.sessions() as db:
        seed(db)
    yield app
    app.state.engine.dispose()
    if admin_engine is not None:
        with admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin_engine.dispose()


@pytest.fixture
def client(app):
    with TestClient(app, base_url='https://testserver') as client:
        yield client


@pytest.fixture
def account(client):
    data = {'email': 'driver@example.com', 'password': 'A-long-test-password-42', 'display_name': 'Test Driver'}
    response = client.post('/api/auth/register', json=data)
    assert response.status_code == 201, response.text
    result = response.json()
    return {**data, **result, 'headers': {'Authorization': f"Bearer {result['access_token']}"}}
