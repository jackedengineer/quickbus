# Changelog

## v0.3.1-preview — 2026-10-31

### Fixed

- Paint search feedback before navigation and reuse seat-row content when switching map/list. Public throttled search samples: 42/37/27 ms; cold outliers remain in evidence.
- Isolate each hosted Razorpay checkout document, bound loading, and keep an app-owned Return button available during provider/network stalls. Reconcile before reopening; retain server-authoritative money and seat decisions.
- Restore popover/seat-drawer focus and correct seat/language accessible names. Hide stale preparation copy once a reservation ends.
- Place the private API near Singapore Neon without caching sessions or availability.

### Verification and limits

- Real public Google/email OTP, saved-detail restoration and hosted test failure/retry/ticket, cancellation and processed full refund were verified after rollout.
- Execute isolated 10,000-trip/400,000-seat/100,000-history, two-Worker load and last-seat exercises. All 24 invariants stayed zero; the capacity gate failed with confirmed free-tier CPU termination.
- Keep the free limited-traffic preview by explicit user choice. Physical VoiceOver audio review was declined. Admin and live payments remain deferred. [Measured evidence](docs/acceptance-hardening.md).

## v0.3.0-preview — 2026-10-29

- Add immutable owned print tickets and bounded, leased confirmation/cancellation email delivery.
- Add policy-versioned whole-booking cancellation with atomic seat release and deduplicated full refunds.
- Add guarded operator trip cancellation and resumable three-booking drains; no admin endpoint.
- Reduce catalogue/search database round trips without caching availability or sessions.
- Add lifecycle-aware disabled-checkout recovery versions, 24 invariant audits and a measured 36-table isolated restore.
- Verify real public sign-in, hosted sandbox failure/retry, email restoration, concurrent cancellation and processed refund on desktop/mobile.
- Keep low-end interaction latency, sustained capacity, physical screen-reader review and intermittent hosted-checkout loading as explicit open acceptance findings. [Evidence and limits](docs/lifecycle-delivery.md).

## v0.2.0-preview — 2026-10-27

### Added

- Razorpay test checkout with explicit launch, failure/retry, restored confirmation and visible refund recovery. No live money or real travel tickets.
- Transactional payment jobs, signed durable event intake and authoritative reconciliation. A late capture refunds without reviving released seats.
- Runtime-enforced immutable money/provider identities, account attempt limits and 17 financial/inventory audit checks.
- Actual desktop/mobile failure→retry→capture and offline-checkout release→capture→processed-refund evidence, refreshed 100-customer Neon contention proof and a 33-table restore drill.

### Fixed

- Allow the hosted SDK's exact HTTPS form destination while retaining nonce/CSP, origin checks and a private API.
- Use an explicit user action to open a prepared order and reset stale hosted documents safely between attempts.
- Keep booking history stable while loading/refreshing; measured mobile CLS improved from 0.19 to 0.00.
- Name labelled booking fields for browser form semantics.

Paid cancellation, print/email tickets, trip drain and the admin dashboard remain future slices.
[Production delivery, evidence and limits](docs/payment-delivery.md).

## v0.1.0-preview — 2026-10-27

- Persist normalized cities/aliases, operators, routes, reusable layouts and service stops; atomically publish immutable trip/seat/stop snapshots and backfill existing trips without replacing reservations.
- Filter real PostgreSQL journeys by date, route and available party capacity, with stable sort and filter-bound pagination. Preserve legacy reads.
- Add keyboard seat-list selection, stop restoration through Google/email OTP, labeled conflicts and preservation of unaffected party selections.
- Save owned passenger/contact review with post-lock expiry checks, version preconditions, idempotent replay and one versioned audit event. Recover stale tabs and interrupted saves without extending holds.
- Verify real production desktop Google and mobile OTP save/reload/release. Record 19 integration checks, a refreshed two-Worker/100-customer Neon proof and a 26-table isolated recovery drill.
- Measure production LCP at 731 ms desktop/839 ms throttled mobile, with zero CLS. Retain one observed 213 ms cold 4× interaction as a profiling follow-up; repeated map/list interaction measured 82 ms.
- Keep payments and admin excluded. The future payment command must enforce the visible 90-second start buffer.

[Production and browser evidence](docs/p1-customer-journey.md).

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
