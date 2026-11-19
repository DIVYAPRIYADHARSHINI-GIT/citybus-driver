# CityBus Driver — separate backend service

FastAPI, SQLAlchemy 2, Alembic, SQLite development storage and PostgreSQL via psycopg. The frontend remains independently playable offline. Stage 6 adds migration **0004**, a stored world/weather catalog, all 24 driving profiles, regional routes, map-aware rooms/courses and leaderboard partitions. Authentication and save/conflict contracts are preserved.

Current measured results and limits: [STAGE6.md](../frontend/docs/STAGE6.md). Protocol/scaling details: [STAGE5.md](../frontend/docs/STAGE5.md). Economy rules: [STAGE4.md](../frontend/docs/STAGE4.md).

For a Vercel frontend and a separately hosted PostgreSQL-backed API, follow [DEPLOY.md](../DEPLOY.md). It supersedes the earlier same-origin-only hosting recommendation and includes the exact single-worker start and migration commands.

## Local setup

Verified toolchain on this host: Python 3.11.15. Keep this environment separate from other workspace projects.

```sh
cd backend
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
.venv/bin/python -m pip install --no-deps -e .
cp environment.example .env
.venv/bin/alembic upgrade head
.venv/bin/python -m app.seed
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

For an existing database, run migrations and seed only; do not recreate it. Seed is idempotent, preserves existing company timetables and adds missing regional plans. Schema creation never happens through `create_all()` at application startup.

In `frontend/`, run `npm ci`, `npm run build`, then `npm run preview -- --port 4173`. Open **http://127.0.0.1:4173/**. Vite proxies `/api` and WebSocket upgrades to port 8000; `CITYBUS_API_PROXY_TARGET` changes that target. Production can use separate HTTPS origins with explicit CORS and cookie configuration; do not run the Vite development server as production hosting.

- OpenAPI: http://127.0.0.1:8000/docs
- Existing health contract: http://127.0.0.1:8000/api/health
- Host health/readiness: http://127.0.0.1:8000/health — 200 only after migrations and world seeding.
- Readiness: http://127.0.0.1:8000/api/ready — requires schema `0004` and seeded worlds.

## Configuration

`app/config.py` loads `.env`; environment variables take precedence.

| Variable | Default / requirement |
| --- | --- |
| `DATABASE_URL` | SQLite `.local/citybus.db`; PostgreSQL example `postgresql+psycopg://citybus:password@localhost:5432/citybus` |
| `ENVIRONMENT` | `development`; use `production` for deployment |
| `JWT_SECRET` | Required outside development, at least 32 characters |
| `COOKIE_SECURE` | `false` locally; must be `true` outside development |
| `COOKIE_SAMESITE` | `lax` by default; `none` requires Secure and is needed for cross-site cookies |
| `CORS_ORIGINS` | Exact JSON array, no paths/trailing slash/wildcards; production requires HTTPS origins |
| `ACCESS_TOKEN_SECONDS` | 600 |
| `REFRESH_TOKEN_SECONDS` | 2,592,000 |
| `RATE_LIMIT_PER_MINUTE` | 240 per client IP per process |
| `LOGIN_ATTEMPTS` / `LOGIN_LOCK_SECONDS` | 5 / 300 |
| `MULTIPLAYER_MAX_ROOMS` | 32 |
| `MULTIPLAYER_MAX_CONNECTIONS` | 128, including pending handshakes |
| `MULTIPLAYER_SNAPSHOT_HZ` | 15, validated range 10–20 |
| `MULTIPLAYER_IDLE_SECONDS` | 1,800 |

Development can generate a restricted `.local/jwt-secret`; it is not a public default. Never publish `.env`, `.local`, databases or signing secrets. Refresh cookies remain HttpOnly and host-only. SameSite defaults to Lax; unrelated Vercel/Render sites require `COOKIE_SAMESITE=none` and `COOKIE_SECURE=true`, but browser third-party-cookie blocking can still prevent refresh. Same-site custom domains or the documented REST proxy are preferred. Logout uses the same configured cookie attributes.

## API domains

Existing endpoint paths remain available:

- `/api/auth/register`, `/login`, `/refresh`, `/logout`: Argon2id password hashing, JWT access sessions, rotating refresh token families, revocation and database-backed login lockout.
- `/api/profile`, `/catalog`, `/fleet`: profile, 24 fictional catalog models, ownership, purchases, paint and upgrades. Every model now has a driving calibration; no manufacturer certification is implied.
- `/api/company`, `/api/tycoon`: drivers/hiring/training, terminals, all seven route plans, assignments, loans, events, fleet maintenance and deterministic integer-cent settlement. Unprocessed catch-up remains capped at the most recent 1,440 UTC minutes.
- `/api/results`, `/api/progression`: bounded, idempotent completed-route intake, XP, money, missions and reputation. No endpoint accepts a replacement company bank balance.
- `/api/saves`, `/api/saves/history`, `/api/saves/conflicts`, `/api/saves/conflicts/{id}/resolve`: versioned settings/session-history backups and explicit retained local/server choices. These cannot overwrite money, XP or owned inventory.
- `/api/social/*`: friend requests, accept/decline, profiles, privacy, direct chat, blocks, mutes and reports.
- `/api/multiplayer/rooms`, `/ticket`, `/ws`, `/rewards`: optional single-process real-time rooms and transactional one-time rewards. Ticket authentication is the first WebSocket message, never a URL bearer parameter.
- `/api/leaderboards`, `/api/leaderboards/weeks`: accepted route/race/profit records, weekly UTC seasons, pagination/privacy, optional `map_id` and `bus_class` filters. Races remain stock CB 120; other classes have route boards and can free-drive in shared rooms.

New world endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/maps` | Stored region definitions and revisions |
| `GET /api/maps/{map_id}` | One region; unknown ids return 404 |
| `GET /api/maps/{map_id}/routes` | Authoritative lines for that region |
| `GET /api/weather` | Clear/rain/damp-fog/rush-hour preset catalog |
| `GET /api/ready` | Migration + world-seed readiness |

Map ids: `northbank`, `meridian`, `coastway`. New route ids: `M1`, `M2`, `H1`, `H2`; `21`, `36`, `80` remain valid. Room creation adds optional `map_id` defaulting to `northbank`. The server binds the course, spawn, bounds, route and reward partition to that map. Client-supplied map/class fields cannot fabricate result rewards.

### Safety and authority

Passwords use Argon2id (64 MiB, time cost 3, parallelism 2). Access JWT type, issuer, audience, expiry and live session are checked. The client keeps access tokens in sessionStorage and refresh credentials in an HttpOnly cookie, never in game saves.

Money uses integer cents. UUID-bound transactions prevent repeated purchases, settlements, result awards and race rewards. PostgreSQL row locks and SQLite `BEGIN IMMEDIATE` protect financial mutations. Offline forecasts are not accepted as authoritative balances. Stale cloud/company/fleet writes require explicit choices and retain conflict evidence.

Input/body limits, explicit-origin checks, per-process rate limiting, structured request logging and centralized JSON errors remain. Request bodies/passwords/tokens are not logged. Blocking is checked in both directions and when a room ticket is consumed.

These controls are not a public-service security certification. Offline result validation is plausibility checking, not cryptographic driving proof. Room movement validation is an envelope/checkpoint model, not authoritative server vehicle physics. Moderation, password reset, email verification, account deletion, MFA, retention/backup operations and distributed abuse controls still need production work.

## Docker + PostgreSQL deployment recipe

`Dockerfile`, `.dockerignore` and `compose.yaml` are supplied. Docker execution was not available on this host; see the Stage 6 verification boundary.

Set `POSTGRES_PASSWORD` to random hexadecimal text (URI-safe), set a distinct random `JWT_SECRET`, and set `CORS_ORIGINS` to a JSON array of the real HTTPS origin. Do not commit their values.

```sh
docker compose up -d db
docker compose run --rm api alembic upgrade head
docker compose run --rm api python -m app.seed
docker compose up -d api
```

The API binds only `127.0.0.1:8000` on the host; PostgreSQL is not published. Serve the frontend build and proxy `/api` (including WebSocket upgrades) behind TLS. The image runs as a non-root user and checks `/api/ready`. Apply migrations as a controlled deployment step and back up PostgreSQL first. Do not remove the named database volume to upgrade.

**Run one Uvicorn worker.** Rooms, tickets, presence, bounded queues and reconnect reservations live in process memory. Restarting that process ends live rooms; durable social data/boards/rewards survive. Multi-worker/host scale-out needs a room directory and sticky routing, shared ticket/reconnect/revocation state, pub/sub, distributed rate limits, durable finalization/outbox recovery and operational failover tests. PostgreSQL alone does not make room actors distributed.

## Tests and generated offline data

```sh
.venv/bin/python scripts/export_catalog.py
.venv/bin/python -m pytest
.venv/bin/python scripts/test_postgres.py
.venv/bin/python scripts/load_multiplayer.py --clients 50 --seconds 30 --regions
```

`test_postgres.py` uses an existing local PostgreSQL role via `/tmp`, creates only a random disposable database, runs the suite with per-test schemas and removes that database. It does not modify existing databases. `CITYBUS_PG_ADMIN_DSN` can select the administrative local connection; the current helper's test connection still assumes a local `/tmp` socket.

The load tool owns a temporary database and API on port 8010, measures actual authenticated WebSocket traffic, and refuses an occupied port. Its results are loopback measurements, not 50 rendered Android clients or a WAN guarantee.

`export_catalog.py` regenerates the frontend catalog, fleet profiles, settlement rules and map/weather JSON. Do not maintain a divergent client catalog by hand. New schema changes require new Alembic migrations. Test reports and screenshots are kept under the backend/frontend `test-results/` directories.
