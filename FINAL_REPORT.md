# CityBus Driver — Final Publication Report

## Links

- **GitHub:** publication pending for `DIVYAPRIYADHARSHINI-GIT/citybus-driver`.
- **Live frontend:** deployment pending.
- **Live backend:** not deployed — Render CLI is not installed.
- **Backend health:** unavailable until the backend exists; no URL has been guessed.
- **Last verification:** publication checks started 19 November 2026 (Asia/Kolkata).
- **Free-plan notice:** a free Render backend may take up to about a minute to wake after idle. Free PostgreSQL expires after 30 days.

## Current status

Git, GitHub CLI and Vercel CLI were present and authenticated. GitHub identity was confirmed as `DIVYAPRIYADHARSHINI-GIT`; the selected Vercel scope was verified as active **Hobby**. No existing CityBus repository/project was found in the completed checks. The Render provisioning step is blocked because Render CLI is unavailable. No account or paid resource has been created, and no payment details have been requested.

This isolated project folder contains only CityBus Driver, not the unrelated projects in the parent workspace. The frontend/backend, stage notes, public documentation and 137 earlier local screenshots were copied; failure screenshots were preserved separately. Dependencies, private environment files, local databases, keys and generated logs were excluded.

## Live test results

Live tests have not run yet. Results and screenshots will be added after the frontend deployment. Login, cloud save and room tests cannot be marked passing while the Render backend is absent.

## Advantages of Designer observed in this work

- Code, configuration and documentation could be read and edited in one workspace.
- Shell/test execution and retained logs made implementation claims verifiable.
- Screenshot and PDF inspection revealed real layout problems, including hidden landscape pedals and report-page overflow.
- Local database, browser, physics and network checks could be run and compared without replacing the existing game systems.

## Designer disadvantages and limits observed

- Long browser journeys and repeated verification take real time; a successful unit suite does not establish live deployment success.
- Platform authentication and account permissions cannot be assumed. The missing Render CLI is a real provisioning blocker, not an app feature failure.
- Desktop touch emulation does not verify real Android hardware, and a local HTTPS test does not certify public TLS/WAN behavior.
- Generated visual artifacts still needed inspection and layout correction; first output was not automatically final quality.

## Scope of improvement

Complete the free Render browser setup, connect the actual API/WSS URLs, and verify login/refresh, cloud conflict handling and multiplayer on the real hosts. Continue real-device testing, longer rendered/network-loss endurance, and the production-art, simulation, localization and operational work documented in [STAGE6.md](frontend/docs/STAGE6.md).

## Unverified

Render hosting/PostgreSQL provisioning, public backend health, live authentication/cloud/multiplayer, Android/controller hardware, long WAN endurance and production capacity are not verified. Earlier local results remain historical evidence only. See [DEPLOY.md](DEPLOY.md) for the free-only manual path; no paid upgrade is authorized.
