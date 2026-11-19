# CityBus Driver — free-only publication and deployment

## Links and status

- GitHub: publication pending for `DIVYAPRIYADHARSHINI-GIT/citybus-driver`.
- Frontend: Vercel Hobby deployment pending.
- Backend and `/health`: **not deployed**. Render CLI is not installed; no Render account, service or database was created by the agent.
- Last verification: 19 November 2026, Asia/Kolkata; see [FINAL_REPORT.md](FINAL_REPORT.md) for actual live results.

Only a public GitHub repository, **Vercel Hobby**, a **Render Free web service** and **Render Free PostgreSQL** are authorized. Do not enter payment details, select a paid plan or upgrade a service. If a provider asks for payment/card verification or does not offer the Free option, stop.

## Repository and local configuration

This is a dedicated CityBus repository, separated from unrelated projects in the parent workspace. Root `.gitignore` excludes dependencies, environments, caches, build output, `.vercel`, local databases, logs and **all `.env*` filenames**. Public templates are named `frontend/environment.example` and `backend/environment.example`; copy one to a local `.env` only when needed. Never commit that resulting `.env`.

No Git LFS or paid storage is needed. Screenshots are committed under `screenshots/` and `bugs/`, with local and live evidence separated. Failure screenshots are preserved. Historical stage notes describe local checks; they do not establish live-hosted behavior.

## Vercel frontend

Use the existing authenticated **Hobby** scope; do not create a Pro team or trial.

| Setting | Value |
| --- | --- |
| Project | `citybus-driver` (use the actual assigned public URL, not a guessed alias) |
| Root Directory | `frontend` |
| Framework | Vite |
| Install | `PUPPETEER_SKIP_DOWNLOAD=true npm ci` |
| Build | `npm run build` |
| Output | `dist` |
| Node | Supported Vite-compatible major; locally tested with Node 26 |

`frontend/vercel.json` contains the static build and service-worker/HTML headers. No blanket SPA rewrite is needed: the application screens live at `/`.

**Until Render exists:** leave `VITE_API_BASE_URL=/api` and `VITE_WS_URL` empty/unset. This is an explicitly **offline/single-player-only deployment**; the Vercel site does not have an API at `/api`. Do not use a guessed `onrender.com` hostname, which could belong to someone else. Login/cloud/multiplayer must be reported blocked, not passing.

**After the actual backend URL exists**, Vercel Dashboard → **citybus-driver → Settings → Environment Variables**, Production environment:

```text
VITE_API_BASE_URL = https://ACTUAL-RENDER-HOST/api
VITE_WS_URL       = wss://ACTUAL-RENDER-HOST/api/multiplayer/ws
```

These URLs are public. Never place database credentials or `JWT_SECRET` in a `VITE_` variable. Redeploy the frontend after changes; build-time environment variables do not modify an already-built bundle. HTTPS pages enforce WSS. The legacy `VITE_API_BASE` alias is supported only when the canonical REST variable is unset.

## Render manual step — exact free-only path

**Why manual:** `render` is not installed in this environment. Per the requested stop rule, the agent did not attempt to obtain a Render token, use browser credentials, create an account or provision Render through an alternate API.

Use an **existing** Render account:

1. Open **https://dashboard.render.com/** and sign in yourself. Do not create an account or enter payment details as part of these instructions.
2. Click **New + → Blueprint**.
3. Connect/select the existing GitHub integration and select **`DIVYAPRIYADHARSHINI-GIT/citybus-driver`**, branch **`main`**. If GitHub asks for repository access, authorize only this repository using your own session. Do not share any token with the agent.
4. Use Blueprint path **`render.yaml`** at the repository root. Choose a blueprint name such as **citybus-driver-free**.
5. At the environment prompt for **`CORS_ORIGINS`**, enter the exact live frontend origin as a JSON array:

   ```text
   ["https://ACTUAL-VERCEL-FRONTEND"]
   ```

   Replace it with the verified frontend link in the final report. No trailing slash, path or wildcard.
6. Review **both** proposed resources before applying:
   - `citybus-driver-api`: **Web Service / Python / Free / Oregon**, root `backend`.
   - `citybus-driver-db`: **PostgreSQL / Free / Oregon**, PostgreSQL 17, database/user `citybus_driver`.
7. If either resource is paid, a payment form appears, a Free database already occupies the workspace's quota, or the blueprint cannot be applied on Free: **stop; do not upgrade or delete another database**.
8. Only when both resources are explicitly Free, click **Apply / Deploy Blueprint**. Render creates the database connection secret internally and generates `JWT_SECRET` using `generateValue`; do not reveal, copy into source, print or commit those values.
9. Open **citybus-driver-api → Logs**. Confirm migrations and seed finish, then Uvicorn starts. Check the service's actual assigned public URL and open **`https://ACTUAL-RENDER-HOST/health`**.
10. Add the actual API/WSS URLs to Vercel as above, redeploy, and run the live acceptance checklist below.

### Exact backend values from the blueprint

| Setting | Value |
| --- | --- |
| Plan | **Free** only |
| Root Directory | `backend` |
| Build command | `python -m pip install -r requirements.lock && python -m pip install --no-deps .` |
| Start command | See below |
| Health check | `/health` |
| Workers / instances | **1 / 1**; no horizontal scaling |
| `PYTHON_VERSION` | `3.11.15` |
| `ENVIRONMENT` | `production` |
| `DATABASE_URL` | Managed secret reference from `citybus-driver-db.connectionString` |
| `JWT_SECRET` | Generated privately by Render, not a literal in Git |
| `COOKIE_SECURE` | `true` |
| `COOKIE_SAMESITE` | `none` for unrelated Vercel/Render sites |
| `CORS_ORIGINS` | Exact frontend HTTPS origin JSON array, entered at blueprint creation |
| Demo room limits | 4 rooms, 32 connections, 10 Hz snapshots; **unverified on Free hardware** |

Free services do not have the paid pre-deploy-command feature. Therefore migrations and seeding are in the single-process start command:

```sh
python -m alembic upgrade head && python -m app.seed && exec python -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --workers 1
```

This retains the documented Uvicorn start, preceded by repeatable migration/seed steps. It runs on each cold start and can add startup time. Do not use `--reload`, multiple workers, a paid worker service or concurrent migration jobs. The current migration head is **0004**; seed installs 24 bus records and four world/weather records. `/health` returns 200 only when the schema and world seed are ready, otherwise 503.

`postgres://` and `postgresql://` managed URLs are normalized to the installed psycopg driver. Preserve provider TLS/query parameters. Alembic does not transfer existing SQLite users into a new PostgreSQL database. Back up/export data before changing databases; never run test fixtures against player storage.

## Exact Free-plan limitations

Official Render documentation was checked on 19 November 2026:

- Free web services support WebSocket traffic, but spin down after **15 minutes without inbound HTTP requests or WebSocket messages**. Waking takes **about one minute**; it may exceed the game's 7-second REST and 8-second handshake timeouts. The report warns that a free backend may take up to about a minute, sometimes longer, to wake.
- A workspace has **750 free instance hours per calendar month**; exhausting them suspends Free services until the next month. Usage is shared across that workspace's Free services.
- Free PostgreSQL allows **one active Free database per workspace**, **1 GB storage**, and **expires after 30 days**. An expired Free database becomes inaccessible and is later deleted under the provider's retention policy. **No paid upgrade is authorized.** Export data before expiry and do not describe this as permanent production persistence.
- Free CPU/RAM are small (the published Free web tier is 0.1 CPU / 512 MB). Multiplayer capacity on that host is not established by earlier laptop tests. Argon2 uses 64 MiB per password operation, so concurrent authentication can pressure memory.
- Free usage/bandwidth/build quotas apply. Do not attach payment details or enable paid overages; if a limit or billing prompt appears, stop rather than upgrading.
- Room actors/tickets/presence are in memory. Restarts, deployments and sleep can end live rooms; the 60-second reconnect reservation only applies while the original process remains alive. Committed data/rewards persist only while the database remains available.
- `SameSite=None; Secure` does not override third-party-cookie blocking. Login may initially succeed while refresh later fails. Test actual target browsers; no paid custom domain is required or purchased here.
- Frontend browser storage is origin-specific. Export local progress before changing the frontend domain. Never clear player storage merely to refresh a service-worker cache.

Sources: [Render Free](https://render.com/docs/free), [WebSockets](https://render.com/docs/websocket), [Blueprint reference](https://render.com/docs/blueprint-spec), [compute plans](https://render.com/docs/compute-plans), [Vercel Hobby](https://vercel.com/docs/plans/hobby). Plans can change; review the actual Free labels before applying a blueprint.

## Live acceptance checklist

1. Main menu renders without application/WebGL errors; start a genuine keyboard/touch drive, accelerate, steer and brake.
2. Inspect API configuration and `/health`. If Render is absent, record the blocker and capture the observed frontend/API problem. Do not invent a health URL or claim online success.
3. Once the backend exists, test registration/login with a disposable account without logging credentials; test access expiry/refresh and reload.
4. Save a drive, verify cloud synchronization and a two-device conflict; retry must not duplicate XP/money.
5. Join a room with independent accounts, verify WSS snapshots/chat/movement, then reload/reconnect and check reward idempotency.
6. Test offline reload after installation and graceful behavior when the backend sleeps or becomes unavailable.
7. Save live captures in `screenshots/live/` and problems in `bugs/live/`; preserve every failure capture and label its actual cause/status.

Earlier local results (378 frontend checks, 246 backend tests on SQLite and live PostgreSQL, separate-origin HTTPS/WSS checks) are not live deployment evidence. The final report records only actions and results actually observed during publication.
