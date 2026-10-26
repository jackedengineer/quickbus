# P0 production hardening

Scope accepted 26 October 2026: keep the live unpaid customer app working while completing these slices sequentially. Admin dashboard/access remains deferred. Synthetic catalog/inventory lives in PostgreSQL and reaches the browser through the real API. Production credentials and data never enter CI fixtures, logs or public evidence.

Completion: all five P0 slices passed real production browser and operational acceptance, including native URL-query redaction and the natural hourly inventory invocation; [evidence](../docs/p0-hardening.md).

## P0-01 — Monitoring and performance baseline

- [x] Correlate frontend/API/dependency logs with server-generated request IDs; bounded route labels, no query strings, identity, bodies, cookies or credentials.
- [x] Expose safe Server-Timing durations; observe actual requests, auth delivery failures and Workers CPU/errors. Add an external scheduled health check with actionable failure output/runbook.
- [x] Capture normal browser load/interaction performance in Chrome DevTools and verify real auth/reserve/reload/release; retain sanitised evidence and limits.

Questions: Is the site available? Which boundary is slow? Are OTP requests failing? Are Workers failing or exhausting CPU? Existing Cloudflare metrics/logs and GitHub Actions are preferred over new paid services. Alerting must be test-fired; do not claim recipient inbox delivery without evidence.

## P0-02 — Scheduled reservation expiry

- [x] A bounded Cloudflare scheduled handler expires due holds using the existing trip-lock/DB-time protocol; duplicate/overlapping runs are safe and do not change active or terminal holds.
- [x] Persist job success/failure heartbeat; fail observably and retry on the next schedule. Preserve lazy expiry as the correctness fallback.
- [x] Observe the real scheduled path plus browser expiry/reclaim; audit events/allocations and rerun contention after changing mutation code.

## P0-03 — Database-backed inventory renewal

- [x] Store renewable service definitions/seat layouts in PostgreSQL; runtime renewal reads them and publishes future trip/seat snapshots atomically.
- [x] Unique source/departure identity and bounded scheduled work prevent duplicates, partial inventory and unbounded execution. Preserve existing trips/reservations; no owner credentials in a Worker.
- [x] Observe repeated renewal, upcoming timetable and browser search/selection from the real database, including horizon/heartbeat checks.

## P0-04 — Release safeguards

- [x] CI runs isolated PostgreSQL integration/contention checks through actual Workers, in addition to build/type/lint/audit; fixtures cannot reach production.
- [x] A controlled release script requires a clean reviewed revision and successful checks, serializes release/migrations, builds production and deploys private API before web; allowlist runtime secrets only.
- [x] Verify deployment health and actual browser flows desktop/mobile; retain source/version evidence and rollback instructions. Any new deployment credential/delegation requires the user's action-time approval before creation/configuration.

## P0-05 — Recovery drill

- [x] Back up via a direct PostgreSQL connection to private ignored storage and restore to an isolated target; never overwrite live reservations or expose production credentials/data.
- [x] Audit restored schema/data/invariants without publishing customer records. Exercise compatible Worker rollback/redeploy and verify the real application.
- [x] Record measured restore/rollback times, data-loss window and limits; no invented RPO/RTO claims. Remove temporary sensitive copies safely after evidence is recorded.

## Browser and motion acceptance

Use actual browser interactions as the primary product acceptance evidence. Focused tests prove concurrency, rollback and schema properties that a browser alone cannot establish. Chrome DevTools MCP is not wired into the tool list. Native app access timed out; the official Chrome DevTools CLI 1.12.0 provides actual isolated-Chrome performance traces, network/console inspection, viewport and reduced-motion controls. Do not attach it to the personal Chrome profile. Use the ordinary browser for existing authorised Google/provider sessions.

Add only restrained transitions in the existing CSS: short press/hover feedback, dialog/seat-panel entrance, stable numeric timers, no layout animation or blanket `transition: all`. Respect `prefers-reduced-motion`. Verify keyboard/focus, rapid interruption, mobile widths and console/network failures. No new animation library is needed.

## Delivery discipline

Keep commits focused at roughly 300–400 changed lines. Each slice records what actually passed; partial acceptance remains unchecked. No admin work or public payments are included. Catalog/publication and passenger review were deliberately kept outside P0 and have since shipped in the separate [P1 customer journey](../docs/p1-customer-journey.md).
