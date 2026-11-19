# Stage 6 — regional expansion, full driving fleet and verification

## Links — publication update

- GitHub: https://github.com/DIVYAPRIYADHARSHINI-GIT/citybus-driver — public, `main`.
- Live frontend: https://citybus-driver.vercel.app — Vercel Hobby, single-player verified.
- Live backend / health: not deployed; Render CLI is unavailable.
- Last live browser verification: **19 November 2026, 17:07:51 IST**. Ten frontend checks passed; login/cloud/rooms are blocked. See [FINAL_REPORT.md](../../FINAL_REPORT.md) and [PDF](../../FINAL_REPORT.pdf).
- A free Render backend may take up to about a minute to wake after idle. Free PostgreSQL expires after 30 days.

The remainder of this stage note records the earlier **local** implementation/verification. It is not a claim that backend features have been verified on a live host. The publication update and final report take precedence for hosting status.

**19 November 2026 · Asia/Kolkata.** Raw JSON reports use UTC timestamps.

**Verification completed at 11:43 IST.** The final post-fix foundation, account/cloud/offline and wear-enabled endurance reruns completed successfully. Remaining product requirements and unverified platforms are explicitly separated below.

## Delivery boundary

This is a substantial, tested Stage 6 extension of the existing game, **not a claim that every requirement for a finished, realistic commercial product is complete**. The game has three playable region graphs, 24 functional driving profiles, regional company/online integration and improved cockpit/offline behavior. Bespoke interiors, production art/texture compression, some simulation features and parts of the requested device/endurance acceptance remain open. They are listed explicitly at the end.

The existing Vite/TypeScript/Three.js/cannon-es frontend and separate FastAPI/SQLAlchemy service were extended, not rewritten. Authentication, financial authority, cloud conflict choices, the durable upload/command queues and the 24-hour settlement cap were retained.

## Earlier notes and limits reviewed first

`STAGE5.md`, `STAGE4.md`, `STAGE3.md`, `STAGE2.md`, the README and `PHYSICS.md` were read before implementation. No `STAGE1.md` existed in the supplied checkout; a clearly labeled reconstructed foundation reference has now been added. The initial baselines passed **203 frontend tests and 97 backend tests**.

| Open item from earlier notes | Stage 6 status |
| --- | --- |
| Seventeen collection-only models | All 24 now have explicit driving profiles and functional geometry/drivetrains; shared procedural cockpit architecture remains. |
| Only one city/course | Two additional connected regions and two additional server-checked courses added. |
| Full routes for every model unverified | 168 physical route/model sweeps now pass in an isolated flat-road harness. This does **not** close full rendered-city collision/traffic/weather acceptance. |
| No long endurance evidence | Three accelerated game-hours of physics/traffic and a short real-WebGL transition soak were run; multi-hour rendered/device endurance remains open. |
| Physical Android/controllers, WAN and distributed rooms | Still unverified/incomplete; no Android SDK/device/emulator or Docker runtime was available. |
| Live PostgreSQL | Already verified in Stage 5, despite stale older notes; the expanded suite was rerun on live PostgreSQL 17.11. |
| Short trajectory replay only | Original 30-second ring retained; a separate locally saved last-trip trajectory archive added, including articulated rear poses. Full historical-world replay remains absent. |
| Active-world cloud resume and roadside/fleet reconciliation | Existing boundaries retained, not silently claimed fixed. |
| Stale READMEs/delivery status | Updated; historical stage notes remain historical. |

Concrete defects fixed during this work include the hard-coded 260 L pump limit, undisposed trailer/instanced graphics resources, articulated load accounting, inherited manual mode on electric buses, missing wide-landscape touch pedals, mirrored backs of roadside signs, shared-weather traffic being influenced by local update timing, and static-cache Origin/Vary misses on a genuine server-offline reload.

## What was built

### Regions and routes

The directed graph remains the common source for visible roads, traffic, signals, stop zones and GPS. New definitions originate in `backend/app/world_data.py` and are exported into the offline client by `scripts/export_catalog.py`.

| Region | Physical road centreline | Roads | Named stops in graph | Passenger lines |
| --- | ---: | ---: | ---: | --- |
| Northbank City | 3.734736 km | 19 | 10 | 21, 36, 80 |
| Meridian Metropolis | 11.894736 km | 53 | 18 | M1 Metropolitan Spine; M2 Arts & Gardens |
| Coastway Intercity | 9.336313 km | 28 | 16 | H1 North Coast Express; H2 Coastal Connector |

The new regions **include the connected Northbank historic district** plus their own extensions. Their totals overlap by the original Northbank network; do not sum them as unique roads. The region API documents are additive world manifests tied to the preserved base graph, not an arbitrary downloadable map editor.

Meridian adds a signalized metropolitan grid, civic plaza, financial/museum/arena districts, station, fuel facility and congestion toll. Coastway adds long express sections, bends, a viaduct, tunnel, toll and rest/fuel areas. New service interactions use the existing proximity, parking, engine and payment rules. GPS and minimaps use each region's bounds. Switching worlds removes/disposes old scenery and collision bodies instead of accumulating them.

**Terrain limit:** city roads and bridge approaches are still flat. Viaducts/tunnels have visible structures and collision geometry but are not an elevated terrain/graded-approach system. This is original procedural art, not geographic or photorealistic scenery.

### Weather, traffic and passengers

All regions support clear, rain, damp fog and rush-hour presets, plus the retained legacy snow approximation. Rain/damp fog select wet grip; fog reduces visibility strongly; wet roads change roughness. The accelerated day/night cycle and manual time selection work across the regions. Shared rooms retain their fixed daylight policy and room-clock weather/events.

Rush hour raises bounded traffic density and slows flow. Existing lane following, signals, crossings, headway, yielding, cars/trucks/police/emergency agents and pedestrian phases remain. Mobile logical traffic is capped at 22; shared rooms retain a deterministic 16-agent stream. This is not a citywide microscopic congestion or fully physical NPC model.

Passengers retain sequential waiting/boarding/payment/alighting, ramp assistance, stop requests and integer-cent tickets. Capacity follows the selected model. Onboard mass is 75 kg per passenger; articulated loads now reach both bodies and large capacities are not silently cut to the old 5,000 kg limit. Comfort, punctuality, smoothness and rule penalties continue into accepted account results and company reputation.

Red-light and speeding events now also add **fictional shift fines of €50 and €15**, once per applicable cooldown. These are game rules, not statements of real traffic law. Hard braking still affects comfort/score rather than inventing a cash fine.

### All 24 driving profiles

The catalog now has four models in each of six categories: mini, city, articulated, coach, double-decker and electric. `backend/app/fleet_specs.py` is authoritative; the exported client profiles drive the actual chassis rather than only a shop illustration.

Profiles specify mass, dimensions, wheelbase, power/torque, RPM limits, gearing/final drive, brakes, steering angle/turn radius, suspension, drag, capacity and fuel/battery behavior. The original CB 120 torque/ratio/braking baseline remains. All five articulated rigs, including electric Aurora E180, use a physical rear body, hinge and additional suspension wheels. Electric buses use the existing motor/energy/regen path and a single-speed D/N/R selector.

Bodies, seats, camera position and trim follow the profile; coaches, double-deckers and electric/articulated variants have category-specific geometry. **These are procedural derivatives with model labels/trim/proportions, not 24 individually authored production interiors.** Manufacturer calibration, tire deformation, detailed pneumatic dynamics and battery thermal behavior are not claimed.

### Cockpit, interface, audio and replay

- Preserved keyboard, mouse, touch and standard-gamepad driving; added modeled ray-pickable accelerator/brake/clutch pedals and their animation.
- Existing steering, gear lever, gauges, interlocks, doors/ramp, indicators, horn, wipers, lights and rear cameras retained.
- Gamepad driving bindings expanded for horn/hazards/ramp. Complete gamepad-only navigation of every modal/menu is **not** implemented.
- Three original synthesized radio stations, retained engine/road/horn/indicator/door sounds, ticket tones and a simple ambient city bed. No recorded commercial audio is bundled.
- Graphics ceiling plus automatic quality scaling with hysteresis; retained chunk streaming, LOD, instancing/batching and mobile caps.
- Separate per-device steering sensitivity, auto-quality and language preferences. Spanish covers selected menus/controls; passenger dialogue and much management text remain English.
- Photo mode pauses local play, hides the interface, permits orbit/lens adjustment and exports a real PNG. It is refused during live multiplayer.
- A one-Hz last-trip trajectory archive retains at most 14,400 frames/four hours and 4 MB, subject to browser storage quota. Articulated rear transforms are recorded/interpolated; legacy recordings without rear data use a straight-rig fallback. The original 300-frame, 10-Hz diagnostic replay remains unchanged.
- Replay is **trajectory-only**, not historical NPC, audio, weather, wheel-suspension or complete dashboard playback. The live physics body is not moved by replay.
- Landscape touch layout is capability-based rather than only a narrow-width breakpoint. Four 44 px-or-larger thumb targets were checked at 844×390, 915×412 and 667×375, with real touch acceleration/braking/release.

### Backend and company

Migration **0004** adds `world_definitions`, map/class board fields and room-participation map identity. Earlier tables/rows remain. Seeding promotes the catalog, stores region/weather documents, backfills route board classification and adds missing company route plans without replacing existing timetables.

New read APIs:

- `GET /api/maps`
- `GET /api/maps/{map_id}`
- `GET /api/maps/{map_id}/routes`
- `GET /api/weather`
- `GET /api/ready` — checks migration/seed readiness

Room creation accepts optional `map_id`, defaulting to Northbank. Route-result/save validation accepts M1/M2/H1/H2 and the new weather preset without changing save schema version 1. Existing endpoint paths remain.

Company management can purchase/assign the expanded fleet and schedule all seven lines, subject to existing ownership, level, capacity, reservation and revision rules. Hiring/training, loans, interest, reputation, events, ticket revenue, fuel/energy and maintenance remain deterministic. New toll-bearing services post explicit integer-cent toll costs. **The 1,440-minute/24-hour catch-up cap and UUID-idempotent command/result authority are unchanged.** Offline forecasts cannot replace server balances.

Argon2id, token/session revocation, refresh rotation, local/server conflict choice, input/body validation, rate limiting, structured logs and existing health behavior remain. No cloud choice can overwrite money/XP. Device preferences and the trajectory archive are separate local data, not credentials or a replacement cloud balance.

### Multiplayer and boards

There is one four-gate, server-timed course per region. The original Northbank course and existing friends/chat/blocking/reconnect behavior remain. Bounds, route, spawn, checkpoint definitions and reward partition follow the room map. Cross-map shared-session result rewards are refused.

Route boards support map/class filtering and weekly UTC seasons; race boards are partitioned by map and their actual class. **Races still use stock CB 120, so non-city race classes are not implemented.** Shared free-driving can use any owned drive-ready model. Company operating-profit boards remain a company-wide concept; regional operating-profit attribution is not a completed feature.

Unique room/player/kind rewards and accepted-result UUIDs continue to prevent double credit. Checkpoint order, server time, speed, jump, acceleration and sustained position/speed checks remain basic anti-cheat envelopes—not authoritative server vehicle physics. A real three-browser run exposed a scheduling-related false-positive jump rejection. A bounded allowance of up to 100 ms of prior-speed movement now handles receipt jitter; separate tests confirm that large jumps and repeated abuse of that slack are still rejected.

Run **one Uvicorn worker**. Rooms/tickets/presence/reconnect reservations are process memory. Restarting the process ends live rooms; durable social/board/reward data survives. Multi-host scale-out still needs room ownership/sticky routing, shared ticket/revocation state, pub/sub, distributed limiting and durable finalization/recovery.

## Offline verification and compatibility

The service worker precaches public same-origin build assets and never caches `/api`. A genuine serving-process shutdown test uncovered `Vary: Origin` mismatches: module/style requests carried Origin while install-time cache requests did not. Matching the dedicated static build cache now ignores Vary, while cross-origin/API requests remain excluded. No authenticated response is added to that cache.

The new offline landscape test stops its **own** preview process, proves an uncached same-origin fetch fails, reloads the installed application and physically drives with touch. This is stronger evidence than relying on page-level network emulation or `navigator.onLine`, which did not isolate service-worker fetches in this browser setup.

Existing local game saves, account slots, result/command UUIDs, cloud revisions/conflicts and company data are retained. Active vehicle/passenger state is still not cloud-resumable. Legacy roadside fueling/repairs and revisioned owned-fleet condition are still not one continuously authoritative simulation; use the owned-fleet garage/reconciliation workflow.

## Run both services

```sh
# Backend — existing database: migrate, do not delete/recreate it.
cd backend
python3.11 -m venv .venv                    # first setup only
.venv/bin/python -m pip install -r requirements.lock
.venv/bin/python -m pip install --no-deps -e .
cp environment.example .env               # first setup only; preserve an existing .env
.venv/bin/alembic upgrade head
.venv/bin/python -m app.seed
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1

# Frontend — another terminal
cd frontend
npm ci
npm run build
npm run preview -- --port 4173
```

Open **http://127.0.0.1:4173/**. Use **Explore the city → Region** for maps, **My garage** for previews and **Company HQ** for owned fleet/economics. Backend setup is optional for local driving. The implementation tests used disposable databases; they did not upgrade or replace the user's existing development database.

### Environment variables

| Variable | Purpose/default |
| --- | --- |
| `DATABASE_URL` | SQLite locally; `postgresql+psycopg://...` for PostgreSQL |
| `ENVIRONMENT` | `development` locally, `production` for deployment |
| `JWT_SECRET` | Random secret, at least 32 characters; required outside development |
| `COOKIE_SECURE` | `false` for local HTTP; required `true` outside development |
| `CORS_ORIGINS` | Explicit JSON array of allowed browser origins |
| `ACCESS_TOKEN_SECONDS` / `REFRESH_TOKEN_SECONDS` | 600 / 2,592,000 |
| `RATE_LIMIT_PER_MINUTE` | 240 per client IP/process |
| `LOGIN_ATTEMPTS` / `LOGIN_LOCK_SECONDS` | 5 / 300 |
| `MULTIPLAYER_MAX_ROOMS` / `MULTIPLAYER_MAX_CONNECTIONS` | 32 / 128 |
| `MULTIPLAYER_SNAPSHOT_HZ` | 15, configurable 10–20 |
| `MULTIPLAYER_IDLE_SECONDS` | 1,800 |
| `CITYBUS_API_PROXY_TARGET` | Vite proxy target; defaults to `http://127.0.0.1:8000` |
| `VITE_API_BASE` | Frontend API prefix; defaults to `/api` |
| `BASE_URL` / `CHROME_PATH` | Browser-test origin / installed Chrome executable |

`backend/Dockerfile`, `.dockerignore` and `compose.yaml` provide a non-root, single-worker API and PostgreSQL 17 recipe. Set `POSTGRES_PASSWORD` (URI-safe random hexadecimal), `JWT_SECRET` and explicit HTTPS `CORS_ORIGINS`; run migrations/seed as a controlled one-off step before bringing up the API. Serve the static frontend and proxy `/api`/WebSocket upgrades behind same-origin TLS. **Docker build/run and public TLS deployment were not verified here.** See `backend/README.md` for commands and scaling requirements.

## Automated checks and measured results

### Suites

| Check | Result |
| --- | ---: |
| Frontend unit/integration | **363 passed** |
| Backend suite, SQLite | **232 passed** |
| Same backend suite, live PostgreSQL 17.11 | **232 passed** |
| TypeScript / production build | Pass |
| Original foundation browser suite | **55 passed** |
| Original city browser suite | **38 passed** |
| Roadside browser suite | **21 passed** |
| Account/API/offline/conflict browser suite | **32 passed** |
| Tycoon browser suite | **20 passed** |
| Expanded 24-model fleet browser suite | **75 passed** |
| Original three-player multiplayer suite | **29 passed** |
| Regional weather/driving/replay browser suite | **57 passed** |
| Three-player new-map race/reconnect suite | **9 passed** |
| Landscape real-touch/server-offline checks | **11 passed** |
| Electric selector/articulated replay/PNG smoke | **8 passed** |
| Isolated physical route/model matrix | **168/168 passed** |

All earlier suites were rerun. Assertions intentionally tied to seven drive-ready models/three company routes were expanded, not removed. After the final cache/layout/electric fixes, directly affected suites were rerun. The browser tests send actual keyboard/touch input and do not use production teleport/finish mutators. Read-only diagnostics remain read-only.

The successful browser runs reported no unhandled application errors or unexpected WebGL/console failures. Deliberate API shutdown, auth expiry/conflicts and the uncached offline probe produce expected network failures; this is not a claim of zero network errors under induced outages.

Backend coverage includes live PostgreSQL SQL/transactions, actual migrations, auth, conflict/reward idempotency, new world APIs, map/class partitions, every model's catalog and 96 new-region/model economic combinations. The local PostgreSQL helper creates/removes only its random database and test schemas. No existing database was modified.

### What the route matrix proves—and does not

`tests/route-matrix.ts` physically steers each of 24 models through all seven route paths with the real 120 Hz Cannon drivetrain/chassis and passenger mass. Passenger service/tickets are exercised programmatically. No pose or velocity is changed after the initial spawn. The final sweep completed **245.362 km**, **12.561 aggregate simulated hours**, in **626.58 wall seconds**; the largest distance to a sampled path point was **4.3 m** (not a measured lane-clearance certification).

This harness uses a **flat physics world without renderer-created buildings, barriers, traffic hulls or weather**. It is not proof of 168 complete rendered city drives. Full browser service is verified for original Line 21 and new M1/H1 with CB 120; all 24 models have real browser acceleration/braking checks. Lines 36/80/M2/H2 and all model/weather/traffic combinations still need full rendered acceptance.

M1's observed browser result: five served, zero missed, €21 fares, 76% comfort, 66% punctuality, 1,104 points. H1: three served, zero missed, €9 fares, €2.50 physical toll expense, 88% comfort, 81% punctuality, 799 points. These are the actual test driver's results, not forced perfect scores.

### Multiplayer load and races

Latest local macOS arm64 / Python 3.11.15 load run, one API process:

| Measurement | Observed |
| --- | ---: |
| Clients / rooms / maps | **50 / 7 / all three** |
| Streaming duration | **30.04 s** |
| Configured / observed snapshot rate | **15 / 14.61 Hz** |
| Average sent pose rate | **14.59 Hz/client** |
| Snapshots / peer-latency samples | **22,437 / 148,107** |
| p50 / p95 / p99 latency | **69.855 / 73.514 / 85.503 ms** |
| Maximum latency | **123.494 ms** |
| API RSS before streaming / sampled peak | **140.97 / 141.50 MiB** |
| RSS after streaming / cleanup | **71.28 / 73.44 MiB** |
| Rejected updates / rooms after cleanup | **0 / 0** |

Method: real registration, authenticated WebSockets, 15 Hz pose send attempts and first peer-snapshot receipt minus sender monotonic time. API RSS is sampled every 100 ms. Observed snapshot rate excludes the initial half-second. Registration precedes the RSS baseline, so +0.53 MiB streaming growth is **not** the total cost of authentication/connections. This is loopback—not WAN/TLS, 50 rendered clients, a 128-user capacity guarantee or long-room endurance.

Three real-keyboard finish times were 41.356–42.422 s in Northbank, 49.887–50.995 s in Meridian and 62.357–63.513 s in Coastway. Corrected successful runs had zero rejected legitimate updates. All maps' tested race rewards remained unchanged after reload/reconnect. Grid order still affects times; this is casual racing, not calibrated competitive time attack.

### Endurance and rendering

A three-game-hour accelerated logical soak exercised the real 120 Hz vehicle with wear enabled and 20 Hz capped traffic, one hour per map, in **20.02 wall seconds**. It retained two physical bodies, at most 300 diagnostic replay frames and 22 traffic agents. After warm-up, explicit-GC heap samples stayed between **19.95 and 20.12 MiB**. Process RSS nevertheless rose from **116.41 to 194.70 MiB** across the recorded samples. That native/JIT/process-memory growth needs longer profiling; it is not being labeled leak-free. Full samples are in `test-results/stage6/endurance.json`. This is **not a WebGL or Android soak**, and stable retained JavaScript objects do not prove absence of native/GPU leaks.

The separate real-WebGL test performed 12 region transitions in about **84 seconds**, high traffic, Balanced quality, 1440×900 desktop Chrome. Sampled rates were **59.78–59.98 FPS**; reported draw calls were about **490 Northbank / 630 Meridian / 431 Coastway**. Post-GC browser JS heap samples ranged **15.42–19.83 MiB**, with region-dependent geometry/texture counts and no monotonic resource-count escalation over this short run. These draw-call counts are still substantial for phones. No fixed Android FPS guarantee is made.

### Commands and evidence

```sh
# backend/
.venv/bin/python -m pytest
.venv/bin/python scripts/test_postgres.py
.venv/bin/python scripts/load_multiplayer.py --clients 50 --seconds 30 --regions

# frontend/ — production preview running; port 8000 free for owned API tests
npm test
npm run build
npm run test:e2e:all
npm run test:route-matrix
npm run test:endurance
npm run test:rendered-soak
# Late focused regressions can also be run individually:
npm run test:e2e:landscape
npm run test:e2e:polish
```

Browser suites own and clean their temporary APIs/databases; the real-offline landscape test owns port 4186 and refuses an occupied port. Tests do not replace unrelated processes. `test:e2e:all` now includes the late landscape/polish scripts; the earlier successful batch and their individual post-fix reports are retained separately.

Evidence:

- `frontend/test-results/stage6/regression/report.json` and suite logs
- `frontend/test-results/stage6/browser.json`, `multiplayer/report.json`
- `frontend/test-results/stage6/matrix.json`, `endurance.json`, `rendered-soak.json`
- `frontend/test-results/stage6/landscape/report.json`, `final-smoke/report.json`
- `backend/test-results/multiplayer-load.json`
- Every map's clear/rain/fog/rush-hour/night/photo screenshots under `frontend/test-results/stage6/`
- Landscape captures at 844/915/667 px; actual PNG export and articulated replay under `final-smoke/`
- Main menu, settings, garage/fleet, account, company/planner/finances, lobby/chat/boards/results screenshots in the corresponding test-result folders

Screenshots were inspected, not merely generated. The Vite large-engine-chunk advisory and upstream Starlette/httpx TestClient deprecation warning remain visible; checks were not weakened to hide them. A test-owned Chrome log-pipe teardown hang was also corrected by releasing only that child's inherited pipes after its process exited; the foundation assertions and failure exit codes were retained, and a subsequent run exited cleanly.

## Remaining work and unverified requirements

1. **Not yet a finished production-art product:** 24 bespoke interiors, photorealistic assets, full localization, compressed GPU texture/atlas pipeline and complete gamepad-only menu/cockpit navigation are not delivered. Procedural assets avoid large external downloads but are not a substitute for texture compression.
2. **Simulation limits remain:** flat city terrain/bridge approaches, simplified collision hulls/tyres/suspension and kinematic NPCs; limited upper-deck/rear-module crowd navigation; simple rush-hour behavior; synthesized rather than recorded audio; no manufacturer handling certification.
3. **Acceptance gap:** the complete rendered route × bus × weather matrix, prolonged reverse/jackknife behavior, dense obstruction cases and several hours of real WebGL play are not verified. The isolated sweep and accelerated logical soak do not close those gaps.
4. **Android/controller gap:** no physical Android device/emulator or real gamepad/sensor run. Desktop touch emulation is labeled as such. Mid-range thermal behavior, memory ceilings and stable mobile frame rates remain unverified.
5. **Deployment gap:** Docker files are supplied but unbuilt/unrun here; public TLS/WSS/WAN/mobile-network behavior, PostgreSQL production backup/failover and multi-worker deployment are unverified. Live local PostgreSQL compatibility is verified.
6. **Online scope:** one process, ghost player buses, stock-CB-120 races, no rematches/skill matchmaking, no complete weekly-prize payout scheduler, no live-room recovery after server restart and no server-authoritative vehicle/NPC physics. Basic plausibility checks are not cheat-proof.
7. **Persistence/economy scope:** no active-world cloud resume or unified continuously authoritative roadside/fleet condition. Long-term balance, rare event combinations and large multi-device outboxes need further soak testing. Company-profit regional attribution is not complete; use the unfiltered company-profit board.
8. **Public-service operations:** richer moderation/admin tooling, retention/deletion, password reset, email verification, MFA, security review, distributed limits and operational monitoring still need work.

## Recommended next steps

First run real Android Chrome and controller acceptance against a matching production build/API, including touch targets, offline cold reload, memory/thermal behavior and sustained FPS. Then run the full rendered route/model/weather matrix and multi-hour eight-player/network-loss sessions. Address the art/interior/terrain/texture and localization gaps, and build/test the supplied container deployment with TLS, backups and failure recovery before public release.

No public deployment, paid service or remote account was provisioned. Changes are confined to the game frontend/backend and their documentation/tests; unrelated workspace projects were preserved.
