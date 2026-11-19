# Stage 4 — fleet and transport company

**Implementation / verification boundary: 18 November 2026, Asia/Kolkata.**

Stages 1–3 remain available. This stage adds a seven-model driving fleet, wear and upgrades, a company dashboard/planner, deterministic AI-service settlement, finances/loans, reputation, maintenance, events and progression. Multiplayer was not started.

## Use it

1. Start the API and frontend as described in the backend README. Existing databases need `alembic upgrade head` and `python -m app.seed`.
2. Open **Company HQ** on the home screen, or **Company** from your account profile.
3. Hire a candidate in **Drivers**.
4. In **Planner**, select a bus, driver and route, enter departure times in **UTC**, set the ticket price, and assign. You can drag a driver card onto a route on the map; selectors provide the touch/keyboard alternative.
5. Services settle after their actual scheduled completion: Line 21 takes three real minutes, Line 36 seven, Line 80 eight. **Settle & refresh** checks the server immediately; the client also polls while visible.
6. Unassign a bus before maintenance or manual driving. Fleet → **Inspect / upgrade** shows revision-bound costs. **Drive this bus** reserves it for manual use and applies its actual handling, wear, upgrades, paint and energy.
7. For an unranked preview without buying, use **My garage → Test-drive seven fleet models**. Rotate the live 3D model by dragging, then choose **Drive this bus**. Test-drive mode does not award account progression.

Guest companies are separate local demonstrations. They remain offline-capable and settle locally, but are not silently imported as account money when someone signs in. An account company must be loaded once online before it can be managed offline.

## Drivable fleet

All values below are **original game calibration**, not manufacturer specifications or certified handling data. Units are metres, kg, kW, N, litres and kWh. Catalog prices remain fictional game prices.

| Model | Class | Mass kg | Nominal body length × width × height m | Peak power kW | Service-brake demand N | Wheel radius m | Energy capacity |
| --- | --- | ---: | --- | ---: | ---: | ---: | --- |
| CB 120 | City | 12,000 | 12 × 2.5 × 3.3 | 204 | 78,000 | 0.50 | 260 L |
| Sprout 60 | Mini | 5,800 | 6.5 × 2.2 × 2.9 | 90 | 38,000 | 0.40 | 85 L |
| Civic 105 | City | 10,200 | 10.5 × 2.5 × 3.2 | 185 | 71,000 | 0.50 | 220 L |
| Link 180 | Articulated | 18,000 | 18 × 2.5 × 3.3 | 260 | 114,000 | 0.50 | 360 L |
| Vista 120 | Coach | 13,800 | 12 × 2.55 × 3.65 | 250 | 90,000 | 0.50 | 400 L |
| Skyline 110 | Double-decker | 15,000 | 11 × 2.55 × 4.3 | 225 | 96,000 | 0.50 | 300 L |
| Leaf E80 | Electric | 9,500 | 8 × 2.4 × 3.2 | 150 | 69,000 | 0.46 | 296 kWh |

The remaining **17 catalog models remain collection-only**. Catalog tests now explicitly expect these seven promoted ids; the earlier “only CB 120” assertion was updated for this intentional feature change, not removed.

Authoritative calibration lives in `backend/app/fleet_specs.py`; `scripts/export_catalog.py` generates the frontend `specs.json`, `rules.json` and catalog fallback. The original CB 120 torque curve, ratios and baseline stopping checks are retained.

### Handling implementation

- Each profile configures the actual cannon-es chassis mass, collision envelope, axle positions, wheel radius, suspension, roll influence, brake demand, drag area and drivetrain scaling. Visual body proportions and cockpit camera position follow the selected profile.
- Diesel models use model-specific power/torque scaling, RPM limits and gearing. The mini bus uses 750–3,000 RPM and a 4.8 final drive; the coach uses a 4.4 final drive. Most other diesel profiles retain 650–2,400 RPM / 5.4 final drive.
- Automatic shift thresholds scale with the RPM range and require forward motion before upshifting. This prevents a free-revving mini bus from shifting through every gear before pulling away.
- **Link 180** has two physical rigid bodies, two raycast-vehicle suspensions, six wheels and a vertical hinge with yaw damping and a soft articulation-limit torque. Front/rear masses are 11,000/7,000 kg. The front section is 10.8 m and rear section 7.2 m; hinge clearance adds approximately 0.4 m to the nominal combined body length. It is not merely one stretched collision box.
- **Skyline 110** has an added upper deck and revised mass/inertia/roll calibration. The `cg_offset_m` calibration positions the collision mass envelope and adjusts roll influence; it is not a measured full mass-distribution model.
- **Leaf E80** uses a single-speed motor: 650 N·m, 10:1 reduction, 150 kW power cap, electrical auxiliary consumption, speed-dependent regenerative braking and a kWh state of charge. It does not consume diesel litres. Battery wear reduces usable capacity; depot charging respects that capacity and cannot create a negative/refunded charging cost.
- The cockpit retains the approved controls, gauges and interlocks. The energy gauge changes to **BATT / kWh** for electric operation. The visible bus variants are procedural, not licensed production vehicle assets.
- City boarding uses the selected vehicle's capacity. Full buses can finish a stop without selling tickets to riders left at the curb. Seats are reused after alighting, and passenger door/seat waypoints scale with the selected front body. Mini-bus seating is reduced rather than displaying all baseline bench rows.

**Geometry/physics limits:** collision hulls are simplified boxes; the articulation limit is a soft stabilizing model, not a certified joint stop. Complex upper-deck/rear-module crowd navigation, detailed battery thermal management, tire deformation and manufacturer suspension geometry are not modeled. Short steering tests and straight acceleration/braking browser runs are verified; full city-route completion with each new model and prolonged reverse/jackknife behavior are not.

## Wear, upgrades and maintenance

Wear uses **basis points, 0–10,000**, for engine/motor, brakes, tires and fuel/battery system. Manual driving accumulates wear with distance; braking adds brake wear. Accepted account results reconcile the deltas with the owned fleet. AI trips apply the same exported integer wear rules on the server and in offline forecasts.

Effects include:

- Engine wear reduces available power; engine upgrades add 6% per rank before wear losses.
- Brake wear reduces service-brake demand; brake upgrades add 8% per rank.
- Tire wear reduces grip; tire upgrades add 3.5% per rank.
- Suspension upgrades add 8% stiffness per rank.
- Seats/interior improve simulated passenger comfort; paint/interior/engine/brake/tire/suspension upgrades have visible finish, lighting or trim/rotor accents in the procedural model.
- Battery wear reduces usable kWh capacity. Fuel-system wear increases diesel consumption. High wear raises deterministic breakdown risk.
- Each upgrade has three ranks. The garage shows its current rank, cost and resulting power/brake/grip values. Apply it to driving by equipping or previewing the updated bus.

Repair estimates are deterministic sums of component wear × published per-basis-point rates, plus body damage. Full repair resets component wear and damage. Scheduled servicing can be set 1–50 km ahead; when an AI service crosses the due mileage, it performs and charges the service only if funds are sufficient, then schedules the next 10 km interval.

AI-service energy is purchased at the depot as an explicit per-trip ledger cost, preserving its stored fuel/SOC. Manual drives consume stored energy. Depot refill/charge is separately charged. These are intentional game abstractions, not a detailed logistics simulation.

### Fleet reconciliation

Every owned bus condition has a revision. Equipping an account bus reserves it from AI assignment and captures that revision. A completed manual route can submit nonnegative mileage/energy/wear deltas with the base revision and stable route UUID.

- Matching revision: apply deltas once.
- Stale revision: accept the independently validated route result once, but preserve the unapplied fleet delta and the server condition in a **FleetConflict** record.
- Company → Fleet offers **conservative delta merge** or **keep current server fleet**. Merge adds mileage/wear and subtracts energy; it never overwrites the bus with an older healthier snapshot. A new inspection revision is required if the fleet changed again.
- Both conflict documents remain retained after the explicit choice. Choosing to keep server state does not repeat or revoke the route's already-processed XP award.

Manual reservation, maintenance and dispatch are intentionally exclusive. Unassign before manual equip/maintenance; release the manual reservation before assigning an AI driver. Current route/vehicle transforms are still not cloud-resumable, and old Stage 2 roadside maintenance is not a full fleet-state snapshot restore.

## Deterministic company simulation

### One rule set, two runtimes

- Server: `backend/app/tycoon_engine.py`.
- Offline: `frontend/src/tycoon/engine.ts`.
- Shared constants: generated `rules.json` and `specs.json`.
- Nine exported golden scenarios compare the complete Python and TypeScript output, not just a headline balance. They cover ordinary settlements, time boundaries, loans, low/high reputation and worn vehicles.
- Integer cents, integer energy units (ml or Wh), integer wear basis points and a stable FNV-style hash avoid nondeterministic random draws and floating-point money drift.
- Events, trips and interest are processed in chronological minute order. One batch advance and repeated minute advances produce identical results within the retained window.

A trip is keyed by **assignment UUID + departure UTC minute**. One active assignment per bus/driver is allowed. Departures must be sorted, unique, non-overlapping, and limited to 48 per UTC day. New assignments cannot produce services before their effective time. Unassignment cancels uncompleted future service settlements; there is no half-completed-trip payroll system.

Each completion computes bounded passenger demand, ticket revenue, depot fuel/electricity, prorated working-time wages, maintenance, seeded fines and wear-related breakdown costs. Driver safety/punctuality/comfort/economy, morale, reputation, fares, vehicle capacity, wear and event choices affect the outcome. Driver wages are prorated from an eight-hour working-day salary; unassigned idle time is not separately charged.

### Catch-up rules

- One simulation slot is **one real minute**. The frontend does not accelerate the production clock.
- Server settlement runs **on demand** under a player lock. The client polls and can explicitly request settlement. No second hidden worker independently credits the same trips.
- At reconnect, at most the **most recent 1,440 minutes / 24 hours** are eligible for unsettled work and interest. Older unprocessed slots are recorded as skipped and are not owed later.
- The cap is anchored to **current server time**, including when replaying multiple queued commands. Replaying historical command timestamps cannot expand the window. A regression test covers that bypass case.
- Commands older than the catch-up window become effective at reconnect time, not retrospectively over the skipped period.
- Future settlement requests are rejected; clock rollback does not reverse confirmed progress.

### Offline queue and exactly-once effects

Account companies use a durable command outbox separate from the driving-save document. Each operation has a UUID, original payload, timestamp and expected company revision. Pending operations are stored independently so another tab cannot erase an operation by replacing one queue array. Applied/cancelled ids have local tombstones; server idempotency is the final authority.

The client keeps the originally sent payload unchanged after an uncertain response. Retrying that UUID returns the prior response rather than charging again. Browser locks serialize same-account company synchronization where supported. A stale revision produces a visible conflict; **explicit retry or cancel** is required, not a silent last-write-wins overwrite.

Offline account figures are labeled **forecasts**, not confirmed bank balances. The server recomputes the same rules and commits authoritative balances. No request accepts a client-supplied profit total or replacement company bank balance. Guest-company balances are local demonstrations and do not become account money on registration.

Exactly-once here means idempotent committed effects under the implemented UUID/transaction rules—not a promise that network delivery never fails, storage cannot fill, or conflicting commands are accepted without user review. Corrupt company caches are protected without replacing the separate driving save.

## Company UI and finances

Company HQ has Overview, Fleet, Drivers, Planner, Terminals, Finances, Events and Progress tabs.

- Driver cards show safety, punctuality, comfort, fuel economy, salary and morale. Training increases one skill; salary adjustments affect morale; firing deactivates assignments.
- Drag a driver card onto a route on the Northbank map, or use the accessible selectors. Departure times are entered explicitly in UTC. The current implementation is an assignment planner, not a freeform road-design editor or a draggable Gantt timeline.
- Terminals can be purchased/unlocked and upgraded by five spaces, capped at 25 per terminal. Fleet purchase checks capacity, including through the legacy shop endpoint.
- Profit trend, cost split and per-route profit are drawn from actual retained ledger entries; empty charts do not invent sample history.
- The local dashboard retains the latest 4,000 company entries. Its daily/monthly filters apply to that retained history. The server's existing `/company/reports` endpoint retains the authoritative ledger and reports full selected UTC periods.
- Loan draws and repayments are financing flows, not operating profit. Interest is an expense capitalized into the loan balance, not also removed from cash. The API reports financing flows and cash flow separately.
- Loans have a €20,000 combined limit, €1,000 minimum draw and **0.12% daily capitalized interest**, rounded upward in cents at a UTC day boundary. Repayment is bounded by outstanding balance and available funds. Catch-up caps also apply to interest.
- Negative cash or excessive debt raises a bankruptcy warning; automatic liquidation is not implemented.
- Reputation affects demand. AI-service punctuality/comfort/safety, fines and breakdowns change it. Accepted manual route results also update reputation once.

## Progression and events

Existing account XP and level progression remain in use. Company dispatch unlocks Line 21 at level 1, Line 36 and additional terminals at level 2, and Line 80 at level 3. Sandbox/manual city access remains available to preserve Stage 2 behavior.

Company daily and weekly missions are keyed to UTC periods: three AI services for the daily reward, fifteen for the weekly reward. Rewards are claimed once by period id. Company achievements include first dispatch and trusted operator. The account's earlier route missions/achievements remain separate and intact.

Deterministic events arrive every three UTC hours and offer explicit choices:

| Event | Response / consequence |
| --- | --- |
| Fuel spike | Pay €50 supply contract: 10% increase instead of 50% |
| Strike | Pay €150 morale settlement; otherwise service fares stop during the event |
| Festival | Pay €100 promotion: 55% demand uplift instead of 20%, bounded by capacity |
| Bad weather | Pay €30 dispatch support to reduce punctuality loss |
| Driver quitting | Pay €100 retention bonus; otherwise a sufficiently low-morale driver can leave |
| Vehicle recall | Free energy-system replacement when accepted; ignored recall adds wear |

Events produce a notification and an Events-tab choice panel; they do not interrupt active driving with a modal. Their financial balance and long-term gameplay pacing have not been professionally tuned.

## API and migration

Migration **0002** adds company state, fleet conditions and retained fleet conflicts. Existing player, inventory, auth, result, ledger and cloud-save tables remain.

- `GET /api/tycoon` — versioned company snapshot, rules and server clock.
- `POST /api/tycoon/settle` — settle eligible work through the server clock or a permitted past target.
- `POST /api/tycoon/commands` — revision-bound, UUID-idempotent commands for hire/train/salary/fire, purchase/assignment, terminal expansion, loan/repayment, maintenance/upgrades/energy, reservations, events and fleet-conflict resolution.
- `GET /api/tycoon/inspection/{bus_id}` — current condition and repair estimate.
- `GET /api/tycoon/fleet-conflicts` — unresolved manual/automated condition conflicts.

Existing REST endpoints and cloud-save conflict logic remain available. The tycoon state is not a writable client blob in the settings cloud save. Server balances cannot be reset by choosing an old local-save version.

## Verification

### Automated logic

Backend coverage includes settlement idempotency, chronological partition invariance, caps, anti-cap-bypass command replay, capitalized interest and repayment, future/overlapping schedule rejection, resource revisions, fleet-delta conflict preservation/resolution, terminal limits, manual-result reputation, financing reports and worn-battery charging. Existing auth, catalog, results, sync and migration suites were rerun.

Frontend coverage includes complete Python/TypeScript golden equality, integer money, forecasts, cap handling, UUID preservation across lost responses/reload, cross-tab pending operations, corrupt cache protection, wear/upgrade math, battery capacity, all seven real cannon-es chassis settling/driving/stopping, steering stability, articulated body/constraint removal and model capacity in city service.

### Browser acceptance

- **20 tycoon checks:** register, hire, assign, wait for a real scheduled service, verify its ledger exactly once, unassign, buy a brake upgrade, review finances, stop the actual API, queue training, reload offline, restart and apply it once, draw/repay a loan and inspect mobile layout.
- The test waits roughly three to four **real minutes** for the first service. It does not set the clock, edit SQL settlement rows or fast-forward a hidden game hook.
- **24 fleet checks:** equip each of the seven profiles, accelerate and brake through ordinary input, verify the articulated rear body, capture renders, and open the guest company on a mobile viewport.
- Earlier Stage 1, city, roadside and real-API/cloud-conflict browser suites were rerun. Only assertions intentionally invalidated by promoting catalog models were updated to expect the exact seven drive-ready ids.

The successful runs reported no application/WebGL errors; deliberate backend-offline network failures were treated as expected outage conditions, not hidden application exceptions. Current counts and generated reports are summarized in `DELIVERY.md`.

Commands:

```sh
# backend
.venv/bin/alembic upgrade head
.venv/bin/python -m app.seed
.venv/bin/python scripts/export_catalog.py
.venv/bin/python scripts/export_tycoon_fixtures.py
.venv/bin/python -m pytest
.venv/bin/alembic check

# frontend, with production preview running
npm test
npm run build
npm run test:e2e:tycoon  # port 8000 must be free; test owns its isolated API
npm run test:e2e:fleet
npm run test:e2e:online
npm run test:e2e
npm run test:e2e:city
npm run test:e2e:roadside
```

## Explicit limitations / not verified

- No multiplayer, leaderboards or friends.
- No live PostgreSQL or multi-worker production deployment test. SQLite transactions and offline PostgreSQL DDL/migration compatibility remain the verified baseline.
- No physical Android/controller testing, prolonged dense-city fleet endurance, battery thermal model or manufacturer handling certification.
- New buses use procedural derivatives of the shared cockpit/body architecture. Upper-deck/rear-module passenger crowd navigation and full city-route completion of every new vehicle are not verified.
- The planner supports driver-to-route drag/drop plus explicit timetable fields; it is not a freeform network builder or time-bar drag editor.
- Automated services are deterministic economic/operational settlements, not separately rendered full-physics buses physically completing every junction in the visible city.
- Long-term economy balance, rare event combinations and very large multi-device outboxes need additional soak testing.
- Current vehicle/passenger transforms and full historical city replay are still not cloud-resumable. Fleet conflicts require an explicit choice rather than silently replacing data.
- Legacy Stage 2 roadside repairs/fueling and the new revisioned fleet garage are not a single continuously network-authoritative vehicle simulation. Use the fleet garage for owned condition reconciliation and re-equip to apply its state.

No paid service, remote database or public deployment was created. Changes are confined to `frontend/` and `backend/`; unrelated workspace projects were preserved.
