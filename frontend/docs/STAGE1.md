# Stage 1 — preserved driving foundation

**Reconstructed reference, 19 November 2026 (Asia/Kolkata).** No `STAGE1.md` existed in the supplied checkout. Stage 6 therefore read the foundation sections of the frontend README and `PHYSICS.md`, plus the Stage 2–5 notes, before implementation. This is not an invented historical test report.

The original frontend uses Vite, TypeScript, Three.js and cannon-es. Its proving ground, four-wheel raycast CB 120, 120 Hz physics, torque curve, six-speed automatic/manual gearbox, clutch/stalling, air brakes, parking brake, steering, suspension, surface grip, load transfer, interactive cockpit, keyboard/pointer/gamepad controls, synthesized audio, garage, tutorial, local saves, offline service worker and 30-second trajectory replay remain available.

Run from `frontend/`:

```sh
npm ci
npm run build
npm run preview -- --port 4173
npm test
npm run test:e2e
```

The baseline read at the start of Stage 6 contained 203 total frontend tests and 97 backend tests, including later stages; both baselines passed. The original foundation browser suite contains 55 assertions and is retained. Current results and new limitations are recorded in `STAGE6.md`, not retroactively assigned to the historical foundation.

See `PHYSICS.md` for the CB 120 calibration and stopping-test method. The model is original game calibration, not a certified driving trainer or a manufacturer-validated bus model. Legacy saves remain schema version 1. The original trajectory replay is not a historical replay of NPCs, audio or the entire cockpit.
