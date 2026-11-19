# CityBus Driver

**Publication:** [GitHub](https://github.com/DIVYAPRIYADHARSHINI-GIT/citybus-driver) · [Live frontend — Vercel Hobby](https://citybus-driver.vercel.app). The Render backend is not deployed; login/cloud/multiplayer are blocked. See the [current final report](../FINAL_REPORT.md) and [free-only deployment steps](../DEPLOY.md).

**Take the wheel. Feel the road. Make every stop matter.**

An offline-first **Vite / TypeScript / Three.js / cannon-es** driving game with a separate optional **FastAPI / SQLAlchemy / Alembic** service. The Stage 1–5 systems remain; Stage 6 adds two connected regions, the full 24-profile fleet, map-aware online features and further cockpit/testing work.

**This remains procedural game-simulation software, not a photorealistic commercial simulator or certified driver trainer.** Read [Stage 6 delivery and verification](docs/STAGE6.md) for exactly what is implemented, measured and still unverified. Earlier stage notes are historical records, not current feature counts.

## Run offline single-player

```sh
cd frontend
npm ci
npm run dev
# Production build, including offline caching:
npm run build
npm run preview -- --port 4173
```

Open **http://127.0.0.1:4173/**. WebGL 2 is required. Audio begins after a user gesture. No account, API key, CDN or backend is needed for local driving. The production service worker installs all game assets after the first successful online load; `/api` is deliberately never cached.

- **Take the wheel:** preserved proving ground, cones, braking tests and suspension strip.
- **Explore the city → Region:** select Northbank City, Meridian Metropolis or Coastway Intercity. The new regions include Northbank as their connected historic district, plus their own roads and services.
- **My garage → Test-drive all 24 fleet models:** unranked previews with real model-specific physics. Account-owned condition and upgrades are equipped through Company HQ.
- **Company HQ:** fleet, drivers/training, assignments, terminals, finances, loans, events and deterministic service settlement.
- **Multiplayer:** optional friends, chat, public/private ghost-bus rooms, three checkpoint courses, map/class-filtered weekly boards and idempotent rewards. Races currently retain the equal-spec CB 120 class.
- **Settings:** weather, day/night cycle, graphics and automatic scaling, audio, steering sensitivity, language, photo mode and save import/export. Spanish covers selected menus/controls; dialogue and much management text remain English.
- **Logbook → Replay last trip:** a locally retained one-Hz bus trajectory, capped at four hours. The original 10-Hz last-30-second diagnostic replay remains unchanged. Neither replays the full historical NPC world.

## Controls

| Input | Action |
| --- | --- |
| W / S, up / down arrows | Accelerator / service brake |
| A / D, left / right arrows | Steering |
| I / P | Engine / parking brake |
| Q / E | Gear down / up; automatic R–N–D |
| M / Shift | Automatic/manual / clutch |
| O / U | Doors / accessibility ramp |
| Z / X / H | Left / right / hazards |
| L / V | Lights / wipers |
| R / B / N | Retarder / horn / synthesized radio stations |
| C / Escape | Camera / pause |

Mouse/touch can operate the cockpit, drag the steering wheel and gear lever, hold the modeled pedals, or use the on-screen controls. Standard gamepad: left stick steering, RT/LT pedals, LB clutch, A doors, B parking, X engine, Y/RB shifting, stick clicks horn/hazards, D-pad lights/retarder/indicators, View camera, Menu pause. Controller models differ; physical hardware testing remains necessary.

For passenger service, stop inside the yellow bay facing the correct direction, apply parking and open doors. Let passengers alight, handle tickets and assistance, retract the ramp, then close doors. The real air reservoir must recover above the door threshold. Rain and damp fog reduce grip; fog reduces visibility. Rush hour raises bounded traffic density and lowers traffic speed. Red lights and speeding incur shift fines as well as score penalties.

## Optional backend

See [backend setup](../backend/README.md) and the [Vercel + persistent-backend deployment guide](../DEPLOY.md). Locally, Vite proxies `/api` (including WebSockets) to `http://127.0.0.1:8000`; `CITYBUS_API_PROXY_TARGET` changes that shell-configured target. For separate hosting, set the public build variables `VITE_API_BASE_URL=https://YOUR-BACKEND/api` and `VITE_WS_URL=wss://YOUR-BACKEND/api/multiplayer/ws`. The REST default is `/api`; `VITE_API_BASE` remains a legacy alias. Read the deployment guide's cookie/SameSite section before using different frontend/backend sites.

Existing databases require:

```sh
cd backend
.venv/bin/alembic upgrade head
.venv/bin/python -m app.seed
```

Migration `0004` preserves old rows and adds stored world definitions and leaderboard/room map fields. Authentication, cloud-save version/conflict choices, durable command/result queues, integer money and the 24-hour settlement cap remain in place. Never replace a database with a fresh test fixture to upgrade it.

## Verification commands

```sh
# Keep production preview running for browser tests.
npm test
npm run build
npm run test:e2e:all             # all prior suites + new regional browser checks
npm run test:route-matrix        # 24 buses × 7 routes, isolated flat-road physics QA
npm run test:endurance           # three accelerated simulation hours, no WebGL
```

Individual scripts remain available: `test:e2e`, `test:e2e:city`, `test:e2e:roadside`, `test:e2e:online`, `test:e2e:tycoon`, `test:e2e:fleet`, `test:e2e:multiplayer`, `test:e2e:stage6`, `test:e2e:regions-online`.

`BASE_URL` and `CHROME_PATH` select the test origin and installed Chrome executable. Connected browser scripts create isolated accounts/databases, refuse an occupied port 8000 and stop only their own API. Evidence is written under `test-results/`; current counts and measured results are in `docs/STAGE6.md`.

The all-route physics sweep is **not** a substitute for all-model browser runs with rendered colliders, traffic, tolls and weather. A phone-sized desktop viewport is **not** a real Android test. Docker files are provided separately; building/running them requires Docker.

## Source organization

- `src/sim/` — preserved drivetrain/vehicle physics, replay interpolation and last-trip archive.
- `src/render/` — cockpit, procedural fleet, scenery, lighting and adaptive quality.
- `src/city/` — shared directed graph, region data, traffic, passengers, scoring, GPS and roadside interactions.
- `src/online/` — authentication transport, account slots, upload queue and explicit cloud conflicts.
- `src/tycoon/` — shared integer rules, local forecasts, durable company commands and management UI.
- `src/multiplayer/` — room client, interpolation, ghost buses, chat and boards.
- `src/storage.ts`, `src/preferences.ts` — legacy-compatible game saves and separate device preferences.
- `../backend/app/world_data.py`, `fleet_specs.py` — authoritative fictional world/fleet calibration, exported by `scripts/export_catalog.py`.

All art and audio are procedural/original. Maps are fictional. The frontend is now published on Vercel Hobby; no paid service or new provider account was created. The backend remains a manual Render step. Game units are metres, seconds, kilograms and integer euro cents, independent of the surrounding CAD workspace's unit setting.
