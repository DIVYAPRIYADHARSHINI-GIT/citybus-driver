"""Run the complete pytest suite against a disposable live local PostgreSQL DB.
Only a newly-created random database is dropped. Existing databases are untouched.
Requires a local role allowed to create a database; no password is requested.
"""
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4
import psycopg
from psycopg import sql

root = Path(__file__).resolve().parents[1]
name = 'citybus_stage5_' + uuid4().hex[:12]
admin = psycopg.connect(os.environ.get('CITYBUS_PG_ADMIN_DSN', 'dbname=postgres host=/tmp'), autocommit=True)
created = False
try:
    version = admin.execute('select version()').fetchone()[0]
    admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    created = True
    environment = {**os.environ, 'CITYBUS_TEST_DATABASE_URL': f'postgresql+psycopg:///{name}?host=/tmp'}
    print('LIVE POSTGRESQL:', version, flush=True)
    result = subprocess.run([sys.executable, '-m', 'pytest', *sys.argv[1:]], cwd=root, env=environment)
    raise SystemExit(result.returncode)
finally:
    if created:
        admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
    admin.close()
