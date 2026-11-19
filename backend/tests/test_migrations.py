from io import StringIO
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from app.config import ROOT
from app.database import engine_for


def test_sqlite_upgrade_downgrade_and_schema_drift(tmp_path):
    cfg = Config(str(ROOT / 'alembic.ini'))
    url = f'sqlite:///{tmp_path}/migration.db'
    cfg.attributes['database_url'] = url
    command.upgrade(cfg, 'head')
    command.check(cfg)
    engine = engine_for(url)
    assert 'cloud_revisions' in inspect(engine).get_table_names()
    engine.dispose()
    command.downgrade(cfg, 'base')
    command.upgrade(cfg, 'head')
    engine = engine_for(url)
    assert 'players' in inspect(engine).get_table_names()
    engine.dispose()


def test_postgresql_offline_ddl_compiles_without_connecting():
    output = StringIO()
    cfg = Config(str(ROOT / 'alembic.ini'), output_buffer=output)
    cfg.attributes['database_url'] = 'postgresql+psycopg://unused:unused@localhost/unused'
    command.upgrade(cfg, 'head', sql=True)
    sql = output.getvalue()
    assert 'CREATE TABLE players' in sql
    assert 'CREATE TABLE sync_conflicts' in sql
    assert 'FOREIGN KEY' in sql
    assert 'JSON' in sql
