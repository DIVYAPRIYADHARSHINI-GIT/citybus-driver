# Stage 2 — Northbank offline city

**Implementation and verification boundary, 18 November 2026 (Asia/Kolkata).**

## Delivered

The city is a separate game mode, not a replacement for the original test track. Its static collision bodies, nearby dynamic traffic hulls and streamed scenery are activated/deactivated with the mode. Returning to the proving ground restores its original collision bodies, spawn, surface classifier, ballast and paint.

### World and graph

The physical road-centreline total is **3,734.7359 m**. Roads form a grid plus a highway connection, with the central junction replaced by four connected one-way roundabout arcs. The graph has explicit named nodes, oriented lane polylines, lane-to-lane connections, speed limits, highway parallel lanes and 10 stop definitions.

The world renderer uses that graph for roads, markings, signs, stop bays and signal locations. Traffic and GPS use the same lane ids and permitted connections. Tests check every lane endpoint/connection, connectivity between all ordinary lane pairs, all route legs, roundabout direction/closure, lane sampling/projection and the no-route case.

Included scenery/features: terminal; ten stop shelters/signs; signalized junctions; crosswalks; a roundabout and central sculpture; divided-lane highway markings; a collidable tunnel roof/walls; a bridge deck over a river surface with physical guardrails; a fuel pump/hose; a repair/wash facility; a toll booth/barrier; roadworks cones; a document-check location; trees, buildings and street lamps.

**Geometry limits:** this is original procedural prototype art. The road physics surface is flat; the bridge is a flat drivable deck over a rendered river, not an elevated graded approach with a fall-through riverbed. The tunnel is a level covered section, not a terrain excavation system. There is no geographic map provider, district streaming from a server, photogrammetry, texture-atlas art pipeline or production traffic-sign certification.

### Mobile optimization

- Static essential road/service geometry remains resident.
- Procedural scenery is generated in **160 × 160 m chunks**. Load radius: 390 m desktop / 270 m mobile. Unload uses an additional 140 m hysteresis to prevent boundary thrashing.
- Unloaded chunk visuals, unique geometry/materials and building collision bodies are removed/disposed. Shared materials remain shared.
- Buildings have detail and simplified LODs, switching at 160 m desktop / 100 m mobile.
- Trees, vehicle hulls/cabs/wheels and people body parts use instancing. Stop-zone markings and static structure meshes are batched.
- Nearby vehicle/pedestrian collision hulls are limited to the area around the player; remote AI stays in a bounded cheap logical simulation.
- Traffic caps: desktop 16/32/52; mobile 10/16/22, with safe-start exclusions where necessary.

Chrome's emulated mobile viewport/touch mode was tested. **No physical Android performance benchmark or memory soak test has been completed**, and no fixed FPS guarantee is made. Low graphics disables mirrors/shadows and is the intended fallback for lower-powered hardware.

## Simulation systems

### AI traffic

Logical agents update at approximately 20 Hz, independent of rendering. Cars, trucks, motorcycles, police and ambulances differ in length, body representation and speed behavior. They use lane tracking, headway-limited target speeds, bounded acceleration/braking, signal stopping, junction reservations, roundabout-entry yielding, bus-merge yielding and emergency-vehicle slowing. Passing is restricted to a checked same-direction highway lane, with a smooth lane-change blend. Pedestrians walk across marked crossings during an all-red interval.

**Limitations:** traffic is kinematic, not a second full raycast-vehicle physics fleet. Nearby hulls can collide with the physical bus, but AI vehicles do not simulate tire forces, body damage or steering actuators. Junction reservations are deliberately conservative. Emergency behavior is simplified slowing/yielding, not a complete priority-dispatch or siren law simulation. Opposing-lane overtaking is intentionally absent. Dense traffic and all turning combinations have not received a long manual soak test; the first full driving-browser acceptance route is the simpler Line 21.

### Stops, passengers and tickets

Each stop has a 20 m longitudinal acceptance zone, a lateral tolerance and a heading check. Service requires a stopped bus with open doors. Waiting people board in sequence after any alighting passengers; the animation pauses at the ticket machine until its real transaction is resolved. A route-level door-close interlock prevents departure with unfinished service. Ramp behavior still uses the original drivetrain's stopped/parking/doors interlocks.

Passenger destinations generate stop requests and a chime. Bags are requested at alighting, not boarding. Elderly passengers need a deployed ramp and explicit assistance; missing-ticket passengers need a sale decision. Actual successful transactions credit integer-cent fares exactly once. Onboard people contribute 75 kg each to the existing chassis load/suspension calculation.

**Limitations:** people are simple instanced procedural figures with waypoint-based movement, not skinned motion-capture characters or a navmesh crowd. Ticket exchanges are dialogs rather than animated hands/cash. Modal interactions pause the world and timetable intentionally. Passenger dialogue is predefined text, not recorded speech or an AI conversation service. Route demand is seeded and bounded; it is not a citywide passenger-demand model. The standing state/aisle pose is supported, but ordinary short seeded routes usually fit within the 24 modeled seats.

### Scoring and results

- Red light: signed front-bumper stop-line crossing while the approached signal is red.
- Speeding: more than 3 km/h over the nearest aligned lane's limit, with an 8-second repeat cooldown.
- Hard braking: acceleration below −3.7 m/s² while moving, with a repeat cooldown.
- Collisions: increments from the original physical body's impact counter.
- Missed stop: explicit confirmation, or driving away after entering the proximity of an unserved stop.
- Recovery: retains passenger fares/progress but applies a penalty and safely repositions before the current stop.
- Punctuality: a ±20-second full-credit window, decreasing outside that window.
- Result: served/missed counts, comfort, punctuality, fares, expenses, points and actual violation log.

A route-end result is saved as a validated optional `route` field on the existing v1 session. Legacy v1 saves still round-trip unchanged. Partial active routes are not resumed after browser reload. This is a local shift score, not an anti-cheat-authoritative economy.

### Interactive services

- Pump: proximity, parking and engine-off checks; attach/detach hose; flow at 1.2 L/s; €1.80/L cumulative billing; tank cap; engine start inhibited while attached.
- Garage: proximity/parking/engine-off checks; damage repair charges only if needed; washing removes the dirt tint and costs €8 only if dirty.
- Toll: nearby stopped payment of €2.50 opens the physical bus barrier; one charge per passage until the bus leaves.
- Jam: graph lane closure, visible cones, traffic response and explicit GPS detour choice.
- Police: checkpoint or seeded request, safe pull-over and document confirmation.
- Breakdown: impact-derived damage threshold or seeded event; engine inhibited; engine off/hazards/triangle prerequisite for €45 roadside repair.

**Limitations:** repair and wash are immediate interactions, not timed mechanic or pressure-washer minigames. Police documents are an offline interaction, not authenticated player licences. The maintenance state is shift-local and not a persistent company fleet. The hose is a simple visible mesh, not a simulated flexible fluid conduit. AI cars do not perform the player's cash toll transaction. Incidents and passenger events are seeded game logic, not real-world live feeds.

## Verification

### Unit/integration coverage

`npm test` contains the original **53** drivetrain/physics/save/replay tests plus **64** Stage 2 tests (**117 total**):

- Physical road length, stop/route counts, directed connectivity, valid connections, highway passing lanes, roundabout closure and direction.
- GPS routes between all scheduled stops, closure detours, destinations behind the bus and unreachable destinations.
- Signal phase exclusion, amber/all-red timing, pedestrian windows, speed/headway, red-light stopping, bus yielding, passing-lane safety and density caps.
- Bounded finite-state traffic progression over a simulated minute.
- Correct stop orientation/position, no boarding while moving/outside/doors closed, door interlocks, greeting, exact change, double-sale prevention, ramp assistance, missing-ticket and bag events.
- Full passenger/stop lifecycle for all three routes, missed stops, stop requests and recovery preserving already-paid fares.
- Penalty cooldowns, punctuality, comfort, front-bumper red/green crossings, fuel safety, cumulative cent billing and overfill protection, hose detachment, toll idempotency, breakdown prerequisites, police checks, detours and backward-compatible save validation.

The Line 36/80 lifecycle tests supply valid stop-state inputs to the pure state machine. **They do not constitute full physical driving of those routes.**

### Browser coverage

The tests use the **production build**, installed Chrome and actual UI input. Production diagnostics are read-only.

1. **Stage 1 regression:** `tests/e2e.mjs` — 55 checks. The original script was left unchanged. It covers keyboard/touch/gamepad driving, cockpit ray-picking, stall/restart, air/door/ramp controls, ticket practice, pause/replay, local saves, corruption protection and offline reload.
2. **Complete city route:** `tests/city-e2e.mjs` — 38 checks. Keyboard input physically drives **all of Line 21**, enters all three zones, boards and alights passengers, issues four tickets for the seeded first shift, resolves bag/ramp requests, finishes/saves, and then drives the original proving ground again. It also tests GPS taps/detours, offline city reload, a second route's offline startup, high-density mobile caps and horizontal overflow.
3. **Roadside interactions:** `tests/city-roadside.mjs` — 21 checks. Actual UI attaches a fuel hose, observes paused vs running fuel billing, prevents engine start, disconnects/restarts, physically drives to the garage, washes at the correct cost, rejects remote toll payment and fabricated police/breakdown interactions, changes density live and checks recovery without fare loss.

Browser suites fail on JavaScript/WebGL console errors. The Stage 1/city suites also reject third-party runtime network requests. JSON reports and screenshots are generated under `test-results/` and should be rerun rather than treated as permanent guarantees for future edits.

### Still not verified

- A complete physical drive of Lines 36 and 80, including every turn, roundabout approach and highway maneuver.
- Physical Android browsers, sensor permissions, real gamepad hardware, mobile thermal behavior or sustained memory/FPS measurements.
- A full browser-driven breakdown repair after a real crash; the state/transaction logic is unit-tested.
- A full browser-driven paid toll crossing and the physical barrier clearance; its transaction/idempotency rules are unit-tested.
- Dense-city endurance behavior, emergency yielding under every combination and pedestrian/traffic interactions under prolonged player obstruction.
- Photorealistic graphics, manufacturer-calibrated handling, validated traffic engineering or driving-training safety.

## Bugs found during Stage 2 work

- The GPS dialog was regenerated every HUD tick, detaching controls between pointer events. The paused dialog now updates only for actual destination/detour changes; the minimap remains live.
- The test driver's repeated digital braking depleted the real air reservoir. The test now waits for compressor recovery; the existing safety model was not weakened.
- Fuel charged by rounding every physics tick drifted from the advertised price. It now bills the difference between rounded cumulative totals, verified across timesteps and near tank capacity.
- Passing-lane selection could oscillate while a lane change was still in progress. Decisions are gated until a change completes.
- Roundabout priority originally applied entry-yield logic to traffic already circulating, which could create circular waits. Entry yielding is now limited to incoming approaches.
- Recovery during boarding could strand a route in its service phase. Recovery now resets the approach/service geometry while retaining paid tickets and recording a penalty.
- Initial interior placement assigned some people to overlapping positions. The cabin now uses four distinct seat positions per row, and alighting follows the door waypoint rather than crossing the bus side wall directly.

## Scope boundary

All work for this stage is in `frontend/`. `backend/` and other workspace projects were not changed. No authentication, cloud sync, transport-company management, online leaderboards, friends or multiplayer was added. Those remain later delivery stages.
