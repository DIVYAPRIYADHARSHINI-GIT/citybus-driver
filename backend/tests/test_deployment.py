import json
import secrets
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text, inspect
from app.config import Settings
from app.main import create_app
from app.database import engine_for
from app.models import WorldDefinition, BusModel
from app.security import COOKIE


def test_host_environment_configuration(monkeypatch):
    secret=secrets.token_urlsafe(48)
    for key,value in {'ENVIRONMENT':'production','DATABASE_URL':'postgres://test:test@localhost/test','JWT_SECRET':secret,'COOKIE_SECURE':'true','COOKIE_SAMESITE':'none','CORS_ORIGINS':json.dumps(['https://driver.example.com'])}.items():
        monkeypatch.setenv(key,value)
    cfg=Settings(_env_file=None)
    assert cfg.database_url.startswith('postgres://')
    assert cfg.signing_key()==secret
    assert cfg.cors_origins==['https://driver.example.com']
    assert cfg.cookie_secure and cfg.cookie_samesite=='none'


@pytest.mark.parametrize('origins',[[],['*'],['https://*.example.com'],['https://example.com/'],['https://example.com/path'],['https://user:pass@example.com'],['https://example.com?token=x']])
def test_cors_requires_exact_origins(origins):
    with pytest.raises(ValueError):Settings(_env_file=None,cors_origins=origins)


def test_cross_site_cookie_requires_secure_and_production_requires_https_origins():
    with pytest.raises(ValueError,match='COOKIE_SECURE'):
        Settings(_env_file=None,cookie_samesite='none',cookie_secure=False)
    with pytest.raises(ValueError,match='HTTPS frontend origins'):
        create_app(Settings(_env_file=None,environment='production',cookie_secure=True))
    with pytest.raises(ValueError,match='JWT_SECRET'):
        Settings(_env_file=None,environment='production',jwt_secret='').signing_key()


@pytest.mark.parametrize('url',['postgres://u:p@localhost/test','postgresql://u:p@localhost/test','postgresql+psycopg://u:p@localhost/test?sslmode=require'])
def test_host_postgres_urls_use_installed_psycopg_driver(url):
    engine=engine_for(url)
    assert engine.url.drivername=='postgresql+psycopg'
    if 'sslmode' in url:assert engine.url.query['sslmode']=='require'
    engine.dispose()


def test_cross_origin_cookie_refresh_logout_and_origin_refusal(app):
    origin='https://driver.example.com'
    cfg=app.state.settings.model_copy(update={'environment':'production','cors_origins':[origin],'cookie_samesite':'none'})
    deployed=create_app(cfg)
    with TestClient(deployed,base_url='https://api.example.net') as client:
        headers={'Origin':origin}
        preflight=client.options('/api/auth/register',headers={**headers,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'})
        assert preflight.status_code==200
        assert preflight.headers['access-control-allow-origin']==origin
        assert preflight.headers['access-control-allow-credentials']=='true'
        response=client.post('/api/auth/register',headers=headers,json={'email':'deploy@example.com','password':'deployment-test-password-42','display_name':'Deploy Test'})
        assert response.status_code==201,response.text
        cookie=response.headers['set-cookie']
        assert 'SameSite=none' in cookie and 'Secure' in cookie and 'HttpOnly' in cookie
        assert 'Domain=' not in cookie
        previous=client.cookies.get(COOKIE)
        assert client.post('/api/auth/refresh',headers=headers).status_code==200
        assert client.cookies.get(COOKIE)!=previous
        refused=client.post('/api/auth/refresh',headers={'Origin':'https://untrusted.example'})
        assert refused.status_code==403 and 'access-control-allow-origin' not in refused.headers
        logout=client.post('/api/auth/logout',headers=headers)
        assert logout.status_code==204
        assert 'SameSite=none' in logout.headers['set-cookie'] and 'Max-Age=0' in logout.headers['set-cookie']
        assert client.post('/api/auth/refresh',headers=headers).status_code==401


def test_fresh_migrations_seed_and_host_readiness(client,app):
    # app fixture migrates a fresh schema. Under test_postgres.py this is a real
    # disposable PostgreSQL database, not merely generated offline SQL.
    with app.state.sessions() as db:
        assert db.execute(text('SELECT version_num FROM alembic_version')).scalar()=='0004'
        assert len(db.scalars(select(BusModel)).all())==24
        assert {'world_definitions','cloud_revisions','board_entries'}<=set(inspect(db.bind).get_table_names())
    assert client.get('/health').status_code==200
    assert client.get('/health').json()==client.get('/api/ready').json()
    assert client.get('/api/health').status_code==200
    with app.state.sessions() as db:
        db.delete(db.get(WorldDefinition,'weather'));db.commit()
    assert client.get('/health').status_code==503
