# Stage 5 — optional multiplayer, leaderboards and friends

**Delivery and verification boundary: 18 November 2026, Asia/Kolkata.**

Stages 1–4 remain available without an account or backend. Multiplayer is an optional menu, not a replacement for local driving, city service, tycoon simulation or the existing save/sync pipeline.

## Try it locally

1. Upgrade and seed the backend: `alembic upgrade head` (now through migration **0003**) and `python -m app.seed`.
2. Run FastAPI with **one Uvicorn worker** and the frontend dev/production preview. The Vite `/api` proxy supports WebSocket upgrades.
3. Sign in, open **Multiplayer**, and use **Friends**, **Play together**, **Leaderboards** or **Privacy**.
4. Create a public/private room or join a six-character code. Capacity is 2–8; city rooms can be driven while waiting for other people, whereas a race requires at least two connected, ready participants.
5. Shared-city drivers select their own Northbank line. Races use **Northbank Sprint**, an equal-spec CB 120 checkpoint class with a five-second countdown.

An interrupted connection can be resumed for **60 seconds** using the room session token and a fresh authenticated connection ticket. A reload exposes **Reconnect to previous room** while the reservation remains valid. The reconnect token is tab/session storage, not part of exported game saves. Expiry or an unavailable server produces an explanation; local single-player remains usable.

## Implemented REST systems

### Leaderboards

`GET /api/leaderboards` supports:

- `board=score|time`: accepted passenger-route score or elapsed simulation time for lines **21, 36 and 80**.
- `board=race`: the server-timed Northbank Sprint course, kept separate from passenger-service route timings.
- `board=profit`: company operating profit from allowed server ledger categories. Loans, repayments, purchases and mission/race windfalls are not fabricated operating revenue.
- `period=weekly|all`, `week=YYYY-MM-DD`, `page`, `page_size`, `around_me` and `friends_only`.
- One best route/race run per visible player; stable tie-breaking; pagination and a centered “around me” slice.

`GET /api/leaderboards/weeks` exposes current and archived week buckets. Weeks start **Monday UTC**. New accepted records enter their server-receipt week; a new week therefore starts empty without a destructive reset job. Historical source entries remain available. Archive **data** is retained, while current privacy, blocks and integrity-review filtering still affect which rows a viewer can see; this is not a frozen public copy of old private profile names.

There is **no raw-score leaderboard POST endpoint**. Route entries are generated only after the existing validated result pipeline accepts a complete route. A retry with the same run UUID returns the existing receipt and creates no new rank/reward; a changed payload under that UUID returns a conflict. Race entries are produced only by the room server after ordered checkpoint completion and server timing. Company entries come from committed eligible ledger rows. The seed command idempotently backfills earlier accepted records.

**Integrity limit:** the existing offline route pipeline performs bounded plausibility validation, not cryptographic proof that an untrusted client really drove. Multiplayer movement validation is stronger but is still an envelope/checkpoint validator, not full server-side vehicle physics.

### Friends, profiles and privacy

- Friend request send/accept/decline/cancel; accepted friends list and removal.
- Search by display name, not email. Public profiles expose name, avatar, level, route statistics and up to six owned buses; they do not expose email, money, credentials or private settings.
- Profile visibility: public to signed-in players, friends-only, or private.
- Online-status visibility: public, friends-only or hidden. “Online” means connected to a room, not merely viewing the website.
- Leaderboard opt-out and owned-showcase selection.
- Block, unblock, mute, unmute and reports.

Block checks are enforced in **both directions** for friend requests, direct messaging, profile access and room entry. A ticket obtained before a block is rechecked when consumed. Blocking a current guest as host removes that guest; a non-host blocker leaves the incompatible room rather than gaining permission to kick someone else's guests. Public room listings expose mode/capacity/member count, not participant identities that would bypass hidden online status. Room participants still see each other's room names and buses.

Reports are stored with authorized message evidence when supplied and return “queued for review.” They do not automatically ban someone. There is no production moderation dashboard or automated report adjudication in this delivery.

## Room server and protocol

### Scope and limits

The room actor runs on one asyncio event loop. SQL work is offloaded to threads. Network writers use bounded per-peer queues so a slow client cannot make the snapshot producer await every socket.

Default configuration:

| Setting | Default |
| --- | ---: |
| Rooms per process | 32 |
| Connections per process | 128, including pending handshakes |
| Players per room | 2–8 capacity |
| Snapshot rate | 15 Hz, configurable 10–20 |
| Client pose rate | 15 Hz |
| Pending connection ticket | 30 s, one use |
| Handshake wait | 5 s |
| Peer heartbeat timeout | 15 s |
| Reconnect reservation | 60 s |
| Idle room expiry | 1,800 s |
| Maximum room lifetime | 7,200 s |
| Finished-race retention | 180 s |
| Outbound queue | 16 messages per connected peer |
| Inbound JSON frame | 4 KB maximum |

Rooms support create, code join, quick match, public/private discovery, ready states and host start/kick/close. The host transfers when the previous host leaves and participants remain. A countdown with fewer than two remaining players returns to the lobby. Expired reservations and idle/closed rooms are cleaned up. Kicked users cannot rejoin that room; block relationships also prevent joining rooms containing the blocker.

### Authentication

The client first requests `POST /api/multiplayer/ticket` using its existing access JWT. The server checks the live auth session, room access/block rules and owned drive-ready model. The one-time ticket is sent in the **first WebSocket message**, not in a URL/query string or a loggable bearer parameter.

`/api/multiplayer/ws` also checks the browser Origin. Refresh/session revocation is checked while peers are connected. Reconnect requires both an authenticated ticket and the hashed room resume token; a code alone cannot steal a reserved player slot. The resume token rotates after successful reattachment.

### Messages

Client operations include `join`, `ping`, `pose`, `ready`, `start`, `chat`, `kick`, `close` and `leave`. Accepted poses carry position, quaternion, signed speed, monotonically increasing sequence, selected control values and articulation angle. Only those simulation controls are sent—not arbitrary keyboard text.

Server messages include `welcome`, `snapshot`, `room`, `pong`, `checkpoint`, `race_result`, `chat`, `rejected`, `error` and `left`. Connection quality is shown from heartbeat RTT and snapshot freshness. Application-level reconnect uses bounded backoff within the reservation window.

The client keeps a short ordered pose buffer, renders about **100 ms behind** the room clock, slerps rotation and permits at most **150 ms extrapolation**. Disconnected ghosts stop extrapolating. Detailed remote rendering is capped at **three buses on desktop / one on mobile**, with simpler proxies for the other peers. Names use screen-bounded tags rather than large near-camera world-space billboards.

## Collision and shared-world policy

**Ghost mode:** player buses have no remote physics bodies and cannot push or collide with each other. Room traffic/pedestrians are also non-colliding with the player's bus in multiplayer; fixed roads/buildings retain local physics. Ghost vehicles are visibly translucent. Single-player collision behavior is unchanged.

Room traffic is a fixed, seeded 16-agent stream, independent of each driver's inputs and device. All clients advance the same lane logic in fixed 50 ms steps using the room clock. It does not yield differently to different players. Weather and roadwork/jam choices are deterministic room-seed/time functions. Signal scoring in shared city uses the shared traffic clock rather than a player's menu-paused route timer.

A ten-minute seeded traffic cycle bounds late-join replay work. Late joins advance in bounded batches until caught up. This is deterministic client reconstruction, **not a server-authoritative NPC physics simulation**. Personal passenger service, vehicle condition and roadside interactions remain per-driver; they are not all replicated world objects.

The existing single-player setup is restored when leaving a room. Multiplayer menus pause only the local bus, not the server race clock or shared traffic. Focus loss clears controls and applies parking rather than pausing the whole room. Recovery leaves the room instead of sending a teleport as a normal update.

## Races and rewards

Current race scope is **one Northbank Sprint course**, four ordered gates and one finish. Races use stock-condition, stock-upgrade CB 120 setups to avoid unimplemented performance classes. Shared city can use the seven owned drive-ready models and their captured condition/upgrades.

The server starts a five-second countdown, measures elapsed monotonic time, validates checkpoint order, applies a minimum finish time/distance, and assigns finish positions. The grid is arranged by join order; recorded times include the grid position. This is a casual prototype race, not a calibrated competitive time-attack standard or matchmaking/skill-rating system.

- First finisher: **100 XP + €50**.
- Other valid finishers: **60 XP + €25**.
- Race achievements: first race and race winner.
- Eligible shared-city completed route: **25 XP + €10**, once per room/player, only through an accepted route result with recorded room movement (at least 200 m, 30 accepted updates and 30 seconds of participation).
- A combined daily multiplayer-reward cap applies. Integrity-review runs do not receive ranked rewards.

Reward rows are unique by room/player/kind. Player updates, ledger entries and race board entries are committed transactionally. Reopening results, replaying completion messages, reconnecting or retrying a reward does not pay again. Accepted shared-city route awards remain the existing idempotent result pipeline; there is no client “give reward” endpoint.

## Movement validation and review

The server rejects malformed/nonfinite/oversized numeric state, invalid rotations, out-of-world positions, impossible initial speed, replayed sequence numbers, excessive speed, acceleration, teleport distance, rotation jumps and sustained position/speed mismatch. Client timestamps are never used to decide race time or elapsed movement allowance. Very frequent packet bursts are dropped; flooding can close the peer.

Rejected updates are not broadcast as authoritative poses. Repeated violations create durable integrity events and a review flag; repeated severe violations remove the peer. Review-flagged players are excluded from visible ranked entries/rewards pending review.

These are deliberately **basic anti-cheat envelopes**. A malicious client can still synthesize physically plausible trajectories. Internet jitter, collisions and device suspension need further tuning; a review flag is not proof of malicious intent. No production anti-cheat certification or automatic moderation appeal workflow is claimed.

## Chat and safety

Room chat uses WebSockets; friend direct messages use authenticated REST with a small visible-conversation poll. Both enforce 1–240 characters, reject control characters, apply Unicode normalization and a small whole-word profanity filter, and limit send rate. Message UUIDs make retries idempotent, including room-history insertion.

Room clients have mute/block/report controls. Direct messages require accepted friendship and no block/mute restriction. Reports cannot read another player's private conversation merely by supplying a message id. Server-side blocking and message checks remain in force even if a client bypasses its UI.

The profanity filter is intentionally basic and can be evaded by language/obfuscation. Human moderation, richer abuse detection, retention policy and operational tools are still required for a public service.

## Verification

### Backend and PostgreSQL

The full backend suite passes **97 tests on SQLite and the same 97 against live PostgreSQL 17.11**. A dedicated random test database and per-test schemas were created and removed; existing databases were not modified. PostgreSQL coverage includes actual SQL/transactions, social/block rules, ranking queries, rewards and WebSocket test lifecycle—not just offline DDL compilation.

New coverage includes validated leaderboard ingestion/deduplication, best-run ranking, pagination, around-me/friends filters, weekly history, profit exclusions, privacy, friend action permissions, blocking, message filtering/rates/idempotency, mute/report evidence, room/connection caps, ready/start/kick/close, one-use tickets, reconnect, origin/binary-frame handling, heartbeat cleanup, movement checks, review flags and exactly-once race/session rewards.

The existing upstream TestClient/httpx deprecation warning remains visible; tests pass without suppressing it.

### Frontend and browsers

- **203 unit/integration checks**, including interpolation, bounded extrapolation, snapshot validation, deterministic shared traffic/events, late-join convergence, race ordering and shared-signal scoring.
- **29 multiplayer browser checks with three independent contexts:** request/accept friendship, friend DM, private race join, remote buses, room chat, ready/countdown, all three buses physically completing the gates, server rewards/leaderboard, reload/reconnect without duplicate credit, block/rejoin refusal, graceful host close, independent shared-city routes, replicated movement, local driving after cleanup and backend-offline fallback.
- All earlier browser suites were rerun: **55 foundation, 38 city, 21 roadside, 32 account/sync, 20 tycoon and 24 fleet** checks.
- Production TypeScript/build succeeds. Successful browser runs reported no unhandled application errors or unexpected WebGL/console failures. Deliberate offline network failures were identified as expected conditions.

The browser race used actual keyboard input and physical bus movement, not teleportation or a hidden finish hook. The three observed finish times were approximately 41–43 seconds, with no rejected legitimate updates in that run. Screenshots of lobby/chat, remote ghosts, race HUD/results, leaderboard, shared city and mobile/offline menu were inspected.

### Measured 50-client load test

Latest repeat, local macOS arm64 / Python 3.11.15, one API process, real authentication and WebSockets:

| Measurement | Result |
| --- | ---: |
| Simulated clients / rooms | **50 / 7** |
| Streaming duration | **20.10 s** |
| Configured snapshot rate | **15 Hz** |
| Average sent pose rate | **14.68 Hz per client** |
| Snapshots received | **15,220** |
| First peer-update latency samples | **99,710** |
| Median / p95 / p99 update latency | **32.342 / 44.426 / 49.328 ms** |
| Maximum observed update latency | **66.316 ms** |
| API RSS before streaming / sampled peak | **145.61 / 145.64 MiB** |
| API RSS after streaming / after cleanup | **45.16 / 60.47 MiB** |
| Rejected movement updates | **0** |
| Rooms remaining after cleanup | **0** |

Method: every peer uses the same monotonic-clock domain in the load generator. Latency is first peer-snapshot receipt minus the sender's send time; duplicate sequence observations are not counted again. API RSS is sampled every 100 ms. Registration and connection setup precede the streaming baseline, so the small streaming RSS increase is **not** the total memory cost of authentication or 50 connections. An earlier repeat had p95 **71.439 ms**, illustrating scheduling variance.

This is a loopback server/network test, **not** 50 rendered WebGL clients, a WAN/TLS benchmark, a capacity guarantee for 128 users, or a long endurance run. Raw results are in `backend/test-results/multiplayer-load.json`.

## Single-process boundary and scaling out

Run this version with **one Uvicorn worker**. Rooms, tickets, reconnect reservations, per-peer queues and live presence are process memory. A process restart ends rooms; durable profiles, friends, reports, boards and credited rewards remain in the database. The 60-second reconnect guarantee applies to a living room process, not a restarted server.

Simply adding `--workers 4` would split room state and violate the routing/blocking assumptions. Production scale-out needs:

1. A room directory and sticky routing to the owning room actor, or a dedicated actor/room service.
2. Shared ticket/reconnect state and revocation/block notifications, typically through Redis or another broker.
3. Cross-process pub/sub or routed messaging for room and direct-message delivery.
4. A distributed rate limiter, trusted-proxy client-IP configuration and TLS/WSS.
5. Durable race finalization/outbox handling, recovery policy, moderation/admin tooling, retention and observability.
6. Load, latency/loss, failover and multi-worker tests at the intended deployment scale.

PostgreSQL compatibility is now verified for the data layer; it does not by itself make the in-memory WebSocket actor distributed.

## Run the checks

```sh
# backend
.venv/bin/alembic upgrade head
.venv/bin/python -m app.seed
.venv/bin/python -m pytest
.venv/bin/python scripts/test_postgres.py
.venv/bin/python scripts/load_multiplayer.py --clients 50 --seconds 20

# frontend, with production preview running and port 8000 free for owned test servers
npm test
npm run build
npm run test:e2e:multiplayer
npm run test:e2e:online
npm run test:e2e:tycoon
npm run test:e2e:fleet
npm run test:e2e
npm run test:e2e:city
npm run test:e2e:roadside
```

The scripts refuse to replace an API already using their test port and stop only their own subprocesses. The PostgreSQL helper creates/drops only its random test database. No public deployment, remote account or paid infrastructure was created.

## Still unverified / deferred

- Production WAN/TLS/mobile-network behavior, physical Android/controller testing and long-running 8-player rendered-room endurance.
- Multi-process/host deployment, server restart recovery of live rooms and distributed moderation/rate limits.
- Full server-side vehicle/NPC physics, cheat-proof offline route verification or comprehensive profanity/abuse moderation.
- Multiple race courses, rematches within one room, matchmaking ratings and equalized competitive grid timing.
- Full passenger-route completion for every fleet model in a shared room; shared-city joins/movement and independent route selection are browser-verified, while full standalone route service remains covered by the prior suites.

The local physics, city, tycoon and save systems remain usable without an account or network. Multiplayer makes no external service requests unless the player chooses to use the optional online features.
