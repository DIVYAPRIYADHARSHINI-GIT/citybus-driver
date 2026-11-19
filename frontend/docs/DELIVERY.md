# CityBus Driver — delivery status

**Current hosting update:** the [public frontend](https://citybus-driver.vercel.app) is live on Vercel Hobby and the [GitHub repository](https://github.com/DIVYAPRIYADHARSHINI-GIT/citybus-driver) is public. Render/backend online flows remain blocked. The counts below are earlier local verification; see [FINAL_REPORT.md](../../FINAL_REPORT.md) for current live results and preserved screenshots.

**19 November 2026 · Asia/Kolkata**

The Stage 6 regional/fleet/backend extension is implemented. **This is still a tested procedural game prototype, not a fully finished commercial simulator.** The authoritative delivery boundary, measured results, commands and remaining product work are in [STAGE6.md](STAGE6.md).

## Current scope

| Stage | Current state |
| --- | --- |
| 1 — driving foundation | Proving ground, original CB 120 physics, cockpit/input, tutorial and local saves preserved. |
| 2 — city service | Northbank, traffic, passengers, tickets, GPS and roadside systems preserved; shared graph extended to new regions. |
| 3 — separate backend | Argon2id/session auth, catalog, progression, versioned saves/conflicts and offline upload queue retained. Migrations now through 0004. |
| 4 — company | Full 24-profile fleet and seven lines available to the existing ownership/dispatch rules; integer settlement and 24-hour cap preserved. |
| 5 — online | Friends, chat, privacy/blocking, rooms, rewards and reconnect preserved; three map-aware checkpoint courses and regional route/race boards. |
| 6 — expansion/polish | Meridian Metropolis, Coastway Intercity, weather/grip integration, full driving catalog, photo/trajectory archive, touch and resource-lifecycle fixes, world APIs and deployment files. Remaining requirements are explicitly documented. |

## Verification snapshot

- **363** frontend unit/integration tests.
- **232** backend tests on SQLite and the same suite on live PostgreSQL 17.11.
- **355** browser assertions across the preserved and new suites, including later targeted landscape and electric/replay/photo checks. Affected suites were rerun after final fixes.
- **168/168** passenger-loaded physical route/model sweeps in an isolated flat-road harness—not full rendered-world collision/traffic acceptance.
- **50 clients / 7 rooms / 3 maps:** configured 15 Hz, observed 14.61 Hz; p95 first peer-update latency **73.514 ms**; zero rejected updates or leftover rooms.
- Three accelerated logical game-hours and a short twelve-transition real-WebGL soak. The latter measured about 59.8–60.0 FPS on this Mac, not an Android guarantee.
- Production build succeeds. Expected upstream build/deprecation warnings remain visible.

## Important remaining limits

No real Android/emulator/controller acceptance, Docker execution, public WAN/TLS deployment or multi-hour rendered-room endurance was verified. Bespoke 24-model interiors, production art/texture compression, full localization/gamepad-only menus, terrain-grade city bridges, authoritative NPC/vehicle networking, distributed room recovery/moderation and complete rendered route × model × weather coverage remain work—not silently marked complete.

The production frontend can run without the backend. Existing development databases were not replaced; follow the migration/seed instructions in [backend/README.md](../../backend/README.md) before using the upgraded API. No paid resources or public deployment were created.
