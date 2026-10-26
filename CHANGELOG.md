# Changelog

## v0.0.3-preview — 2026-10-26

- Add correlated web/API/dependency timings, tested Cloudflare error monitoring and scheduled external health probes.
- Expire reservations through a bounded real Cron handler; renew future database-backed trip/seat snapshots from persistent service definitions. Preserve existing reservations and immutable quotes.
- Run real Workers against isolated PostgreSQL in CI and require clean exact-revision green CI for serialized API-before-web releases.
- Complete a consistent production backup/isolated restore and compatible Worker rollback/redeploy drill with measured timings and invariant audits.
- Add restrained reduced-motion-aware feedback, restore keyboard focus after modal close, and reuse fixed formatters after DevTools profiling. Three throttled search samples per revision improved median INP from 318 to 96 ms; one later sample remained 239 ms.
- Enable native URL-query redaction after discovering provider enrichment on callback logs; verify a fresh Google flow and both Worker records. Reconcile completed tasks and clearly defer the admin/paid lifecycle.

[Production, browser and recovery evidence](docs/p0-hardening.md).

## v0.0.2-preview — 2026-10-26

### Changed

- KwikBus now opens at https://kwikbus.jacked.dev with Google and email OTP sign-in. The original preview links redirect to it.
- Verified two-seat Google booking on mobile and email OTP booking on desktop, including selection restoration, full reload and release. These remain unpaid demonstration reservations.

### Fixed

- Recover browsers that cached the earlier staging redirect without clearing their session cookies or application storage.

[Deployment and browser evidence](docs/domain-cutover.md).

## v0.0.1-preview — 2026-10-25

- Initial Cloudflare preview with Google sign-in, search, seat selection and unpaid reservation/release. [Release evidence](docs/release-v0.md).
