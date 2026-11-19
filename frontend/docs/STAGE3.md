# Stage 3 — optional backend and offline-safe account layer

Implementation and verification boundary: **18 November 2026, Asia/Kolkata**.

## Delivered architecture

### Backend

`backend/` contains a working FastAPI REST service with SQLAlchemy 2 models, an explicit Alembic migration, SQLite development storage, PostgreSQL URL support, `.env` configuration, an idempotent catalog seed/export command and pytest tests.

Implemented domains:

- Register, login, refresh and logout; Argon2id password hashes; JWT expiry/type/issuer/audience validation; database-backed login lockouts; session-family revocation and refresh-token reuse detection.
- Profile display name, predefined avatar, level, XP, integer-cent money, bounded settings and unlocks.
- Twenty-four fictional bus catalog records across six classes, plus owned-bus inventory, paint, bounded upgrade records, fuel, damage and mileage fields.
- Company driver hiring/firing/training, skills and salary fields; terminals; Northbank route plans/timetables; ticket-price planning fields; real income/expense ledger and daily/monthly reports.
- Route-result submission, server-side plausibility checks, idempotent XP/money/mission rewards and achievements.
- Versioned cloud saves, immutable revisions, explicit conflict records, local/server resolution and protection against a third device changing the head during resolution.
- Request/body validation, CORS, general rate limiting, centralized JSON errors, structured request logs, OpenAPI docs and setup documentation.

### Frontend

The optional online layer is isolated under `src/online/` and integrated through the existing local store/session-finishing hook. The bus physics, city traffic, route/service logic and test-track geometry were not replaced.

- Header account/cloud button; register/login; live profile/cloud status; shop; owned fleet and paint; company roster/report view; mission/achievement view; explicit two-version cloud conflict dialog.
- Access token in **sessionStorage**, rotating refresh token in an **HttpOnly cookie**. No tokens are stored inside a game save or exported with the logbook.
- Browser-wide refresh lock and per-account sync lock where Web Locks is supported, plus single-flight refresh inside a tab.
- Request timeout and bounded exponential backoff. Unsafe auth submissions are not automatically replayed. Mutating operations that are retried use a stable UUID/idempotency contract.
- Durable, account-scoped route-result queue. Each completed account-linked route gets a persistent run UUID before upload. Server rejection is visible for review rather than silently credited or dropped.
- Separate guest/account local slots. Legacy v1 saves still load. A different account taking ownership in another tab prevents the stale tab from overwriting that account's active save; the stale tab's finished state is retained in its own slot.
- Complete local gameplay and a bundled/cached catalog when the backend is unreachable. Guest play does not poll the backend. Linked accounts retry on reconnect and periodic visible-tab checks.
- `/api` is excluded from the service-worker cache; the game assets and procedural city continue to be cached for offline use.

## Authority and compatibility decisions

### The local game is still local-first

Local save persistence happens before attempting result upload. A failed request does not block driving or clear the queue. Reloading with the backend stopped preserves the logbook, cached account identity and pending result.

Initial guest drives can later be backed up as logbook entries but do **not** retroactively grant account XP. Account-linked offline drives do queue progression submissions. This prevents a shared guest log from being silently credited to each account that signs in.

An offline logout clears this device's access state and preserves its account slot. If the API cannot be contacted, server-side revocation is deferred; it is retried before the next sign-in. A server cannot revoke a token while unreachable, and the UI/documentation do not claim otherwise.

### Cloud saves cannot mint money

Cloud documents contain validated local settings and session history. They cannot replace player money, XP, owned buses or JWT/session records. Result awards, purchases and roster costs are committed by authenticated server transactions.

A stale save creates a local revision and a conflict pointing to the server revision. Both are retained. The explicit choice writes another revision rather than deleting either. The client also keeps its latest device copy before applying a server choice. If local edits happened after the conflict snapshot, choosing local preserves those newer edits and syncs them afterward.

### Catalog data does not pretend to add unimplemented physics

Only **CB 120** is drive-ready. Its mass, wheelbase, radius, torque curve, gear ratios, RPM limits and fuel tank are compared to the actual Stage 1 code in tests. The other 23 models have category-appropriate catalog fields but no claimed compatible physics profile. Electric buses use a battery field and zero diesel tank volume.

They can be collected as account inventory, but the frontend disables driving them until dedicated geometry and drivetrain support exists. The shop's generic illustrations are labeled catalog art, not exact new 3D models. Inventory upgrades do not silently alter the approved physics.

### Company APIs precede full tycoon simulation

Hire/fire/train, terminal purchases, route-plan edits, ticket-price fields and reports are real API operations. The current company UI provides roster actions, owned terminal/route summaries and a monthly report. A complete drag/drop planner, terminal purchase workflow and unattended driver business simulation remain Stage 4 work.

Salary and custom company ticket-price fields are planning data, not a hidden background earnings process. They do not yet replace the offline city's existing fare table. Owned-bus mileage, fuel consumption and impact damage are updated from accepted results; full reconciliation of local refueling/repair actions and active vehicle-state resumption is not yet implemented.

## Validation and security scope

The API checks complete route stop totals, conservative minimum duration/distance, distance/time and consumption bounds, bounded passenger fares and increments, expense/penalty limits, score consistency, timestamp windows and owned-bus compatibility. It rejects direct profile economy edits. Reusing a result UUID with the same payload returns the prior award; using it for different data is a conflict.

SQLite writes use `BEGIN IMMEDIATE` before auth reads. PostgreSQL paths use row locks. Purchases/training/save operations use idempotent UUIDs, and a concurrency test verifies that simultaneous duplicate result submissions credit exactly once.

These checks are **not proof that an untrusted offline client genuinely drove**. Multiplayer-grade authoritative simulation, distributed anti-cheat and leaderboards remain outside this stage. The intake cap bounds abuse but is not a security guarantee.

General rate limiting is in-process; login lockouts are database-backed. A multi-worker production deployment still needs a shared limiter, TLS, trusted proxy configuration, monitoring and backup/retention policies. Password reset, email verification, account deletion, MFA and a production security audit are not implemented.

## Verified

### Backend tests

**42 pytest tests pass**, covering:

- Register/login/profile, password hashes, case-normalized email uniqueness, request validation and no password echo in validation errors.
- HttpOnly refresh cookies, refresh rotation/reuse revocation, JWT expiry/audience/type, logout invalidation and persistent brute-force lockout.
- Twenty-four seeded models, frontend fallback equivalence, CB 120 compatibility, electric energy fields.
- Purchase idempotency, money checks, level locks, owned-resource isolation, paint validation and bounded upgrade actions.
- Driver hire/train/fire and ownership, terminals, timetable validation, ledger reports.
- Valid result awards, invalid result rejection without side effects, concurrent duplicate submission, mileage/fuel recording, levels/unlocks and one-time mission rewards.
- Save versions, both conflict choices, retained history, third-device stale resolution and cross-account isolation.
- CORS, request/body limits, rate-limit response format, docs and health.
- SQLite migration upgrade/downgrade/upgrade, schema drift check and **PostgreSQL offline DDL generation**.

No live PostgreSQL database was used. The installed Starlette version emits a deprecation warning about its httpx-backed TestClient; the tests pass, and that warning is not hidden.

### Frontend unit/integration tests

**140 tests pass**: 117 existing Stage 1/2 tests plus 23 online-layer checks. New tests include bounded retry/backoff, unsafe-POST behavior, single-flight and simultaneous-401 refresh handling, account mismatch protection, token-storage boundaries, save UUIDs, deterministic fingerprints, durable queueing, legacy-save compatibility, native fetch binding, actual CB 120 catalog/physics equality, in-flight-sync logout ordering and cross-tab account isolation.

### Browser integration

The Stage 3 suite has **32 passing checks** against the production client and a real API process/database. It:

1. Registers and logs in through the actual UI; verifies a profile and HttpOnly refresh cookie.
2. Loads all 24 catalog models, purchases a minibus, verifies the debit and prevents driving unsupported catalog models.
3. Logs out and back in, then physically drives all three Line 21 stops with normal keyboard/UI input, boarding, tickets and departure.
4. **Terminates the real API process before saving the result**, confirms the durable queue, reloads with the API still down, and drives the proving ground.
5. Restarts the same database, syncs the queued result, checks actual persisted fares/XP/money and verifies no double credit after reload.
6. Uses a second independent browser context as another device, restores cloud state by choice, creates conflicting paint changes, displays both snapshots and resolves explicitly.
7. Confirms both snapshots remain in server history and that a cloud choice does not overwrite XP/money.
8. Checks mobile account layout and distinguishes expected API-failure/expiry/conflict responses from unexpected console or application errors.

The successful run reported **zero unhandled application errors and zero unexpected console errors**. Expected network failures were deliberately induced during server shutdown; those are not described as a zero-network-error run. The test records actual penalties for the test driver's harsh braking rather than forcing a perfect route score.

The original browser suites remain unchanged and pass with no backend process: **55 Stage 1**, **38 city-route**, **21 roadside** checks. They verify existing keyboard/touch/gamepad behavior, physical movement/stopping, cockpit interactions, local saves, offline reload, route service and city/world switching.

Commands and evidence:

```sh
# backend/
.venv/bin/python -m pytest
.venv/bin/alembic check

# frontend/ — production preview must be running
npm test
npm run build
npm run test:e2e:online   # requires port 8000 free; starts/stops only its own API
npm run test:e2e
npm run test:e2e:city
npm run test:e2e:roadside
```

- `test-results/online/report.json` — Stage 3 counts, refresh activity and earned progress.
- `test-results/online/` — profile, shop, completed route, offline catalog, conflict and mobile screenshots.
- Prior game reports remain under `test-results/` and `test-results/city/`.

Screenshots were inspected and the mobile balance layout was corrected so the currency value does not split over lines. The browser integration also exposed a native `fetch` receiver-binding bug missed by transport mocks; the default transport now calls global fetch correctly and has a regression test.

## Not verified or not included

- A live PostgreSQL service, multi-worker production execution, a public TLS/reverse-proxy deployment or distributed limiting.
- Physical Android hardware, real controller/sensor behavior, and long-duration network-flap/large-outbox tests.
- Full driving geometry/physics for the 23 collection-only bus models.
- Full local-maintenance reconciliation into cloud fleet state, or resuming a currently active route from the cloud.
- Full physical-driving browser completion of Northbank Lines 36/80; their earlier graph/lifecycle coverage is unchanged.
- Stage 4's automatic company economy and full management UI.
- **Multiplayer, leaderboards and friends — reserved for Stage 5.**

No public service, paid account or external database was provisioned. A local SQLite database, restricted development signing-secret file and local Python environment were created for this implementation; tests use isolated temporary databases and fictional accounts.
