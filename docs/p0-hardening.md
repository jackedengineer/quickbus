# P0 hardening — 26 October 2026

Source implementation is complete; production deployment, browser acceptance and the live restore/rollback drill are the remaining release gates. Admin and public payments remain out of scope. Follow the [active checklist](../tasks/p0-hardening.md).

## Verified before rollout

- Build, lint, strict TypeScript and both Worker bundles pass. Two focused unit checks cover concurrent trace isolation/privacy and refusal of remote/production CI transport overrides.
- Twelve integration checks passed on real Neon through local Workers. The updated [contention artifact](evidence/p0-neon-concurrency-2026-10-26.json) records the exact API/backend/database/migration sources: 100 customers through two API instances, one winner and 99 conflicts, plus replay/party/expiry/lock-timeout/rollback and independent SQL audits.
- The same integration/contention pipeline passed on disposable PostgreSQL 18 through Neon's WebSocket proxy, both locally and on GitHub Actions. This complements Neon evidence; it is not a claim about Neon pooler performance or a production load SLO.
- A real local browser selected seat 8A, used email OTP, restored its selection, reserved and survived a full reload. After ten minutes the UI showed expiry. Before invoking the real local scheduled handler, SQL still showed HELD/one allocation/no expiry event; afterward it showed EXPIRED/zero allocations/one event. [Aggregate audit](evidence/p0-2026-10-26/natural-expiry.json).
- Scheduled expiry preserves active holds under overlapping invocations. Inventory renewal rejects incomplete layouts, converges on unique departures under overlap, and rolls back all trip/seat writes after an injected seat failure.
- Chrome DevTools CLI 1.12.0 captured the production baseline in an isolated headless profile with statistics/CrUX reporting disabled: 1200 × 2029, no CPU/network throttling, cold cache, LCP 965 ms, TTFB 619 ms, CLS 0. These are single lab observations, not field data or a device/traffic guarantee. Raw traces remain private/ignored.
- Normal dialog/drawer transitions report 160 ms in the actual browser. At 390 × 844 with reduced motion enabled, transition duration is 0s, animation is none and document/scroll widths are both 390. Only opacity/transform and short press feedback were added; no library or page-load animation.
- Production mobile interaction exposed lost keyboard focus after Escape. The dialog now closes its native modal, restores the connected opener without scrolling, and handles Escape once through the native cancel event. The reproduced local flow now returns focus to the original Continue link with no open dialog or retained body scroll lock; final production confirmation follows the patch rollout.

## Operational model

Every request has a server-generated UUID propagated to the private API. Route labels are bounded, including Start server functions; logs contain no identity, bodies, query strings or credentials. API, binding, session, email, trip-lock and command timings distinguish boundaries. Idle-pool failures retain the request/job correlation. [Signals and incident response](operations.md).

Cloudflare monitor **KwikBus application errors** (`98f43b5fff404d618cb30f4d97c0119b`) is enabled for error-level logs from the two KwikBus Workers only: threshold >=1, ten-minute execution/window, one-hour repeats, delivery to the existing account owner. Its Test action was confirmed in the provider UI. Recipient inbox delivery is not independently certified. External GitHub health monitoring activates when its workflow lands on main; it checks database readiness, job freshness/horizon, public auth configuration, inventory and the homepage without sending OTP or making reservations.

Expiry runs every minute and retains lazy expiry as the inventory safety fallback. Inventory renewal runs hourly, reads persistent service/seat definitions and publishes at most five future departures per invocation. A unique service/departure constraint and one-statement snapshot publication prevent duplicates and partial inventory. The runtime can read definitions and insert snapshots; it cannot edit definitions or own the schema. Initial seeding adopts existing trip identities and preserves bookings/quotes. Search defaults and vehicle labels are database-derived.

[Controlled release](releasing.md) requires clean pushed main and exact-revision green CI, serializes operators/migrations, preserves secrets and captures both Worker versions. [Recovery](recovery.md) uses a consistent verified-TLS snapshot and a target with no network; it never restores over production. Actual rollout/recovery results must be appended before marking P0 complete.
