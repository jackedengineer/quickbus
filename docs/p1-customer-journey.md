# P1 customer journey

**v0.1.0-preview is live at [kwikbus.jacked.dev](https://kwikbus.jacked.dev/).** Reviewed source `3bbc9369329583882c76df27a63f31be850219b5` passed exact-revision CI and the guarded production rollout. [Deployment/browser evidence](evidence/p1-deployment-2026-10-27.json) records Worker versions, source proof, timings and limits.

## Delivered behavior

- Owner tooling persists five cities, aliases (including Bangalore/Poona/Bombay), three clearly synthetic operators, four directional routes, reusable seat geometry, service fares and pickup/drop definitions. The web has no catalog or availability fixtures. Admin remains out of scope.
- A bounded SQL statement validates complete layout geometry and ordered stops before publishing trip, all seats and all immutable stop snapshots. Injected seat and stop failures roll back publication. Repeat seeding preserves snapshot IDs and fares.
- Search filters canonical route, India date and live advisory capacity in PostgreSQL. Departure/price ordering uses a UUID tie-breaker. Validated cursors bind filters and page size; changing filters invalidates an old cursor. The bounded V0 read remains compatible.
- The drawer requires stop choices and the requested party size. Seat and stop IDs survive Google/email sign-in return URLs. A successful hold opens the owned reservation review. Older holds with missing choices stay explicitly incomplete.
- Review saves passenger names, selected stops, verified account email and an optional normalized international phone. It requires a version precondition and stable request key. Transactional validation, expiry cleanup, version increment, event and replay prevent partial/stale writes. Release never leaves ownership behind.
- Customer drafts stay in page memory. Conflicting tabs retain their draft and require an explicit saved-version reload. Interrupted saves lock the submitted intent for safe retry. Names/contact details are absent from URLs, browser storage, event payloads and logs.

This is an unpaid preview. Details do not extend the deadline or issue a ticket. The 90-second payment-start requirement is visible; the future payment command must enforce it using post-lock DB time. T15's full payment-initiation acceptance is deliberately still open until T17 exists.

## Actual browser acceptance

Chrome DevTools CLI 1.12.0 controlled isolated Chrome contexts on the development Workers and real Neon development database. The Chrome DevTools MCP server is not configured. Test accounts use reserved `.test` addresses with the local development mailbox; no session or code is exported.

- Alias suggestion → keyboard Enter → server results → overnight arrival dates → cursor next/first page.
- Email OTP → restored seat and stop selection → hold → stop/name/contact review → save → full reload.
- Two separate customer contexts choose the same seat. One wins; the other receives `SEATS_UNAVAILABLE`, refreshed availability and a persistent explanation in the fixed mobile footer. Repeated with seats 1A, 1B and 1C; holds were released afterward.
- A saved desktop version rejects an older mobile draft with 412. Its unsaved name remains visible; reload recovers the saved version.
- An invalid phone produces useful validation. Offline save retains the exact intent and disables editing; reconnect + retry saves once and displays the normalized phone.
- A real ten-minute hold reaches the under-90-second notice and expires naturally. Editing becomes disabled and a full reload preserves the expired state; the deadline was never shortened through SQL for this browser check.
- Keyboard Tab/Space selects a two-seat party in the equivalent list view. A conflict names 1A and retains 1B; choosing 1C successfully reserves 1B/1C for ₹998. Map/list switching preserves the same selection.
- 320 px search/drawer and 390 px review show no horizontal overflow. Reduced-motion emulation removes the transform/scale effects. Focus moves to review and native dialogs preserve keyboard access.

Reviewed captures: [mobile seat list](evidence/p1-2026-10-27/mobile-seat-list.png), [mobile conflict](evidence/p1-2026-10-27/mobile-seat-conflict.png), [expired mobile review](evidence/p1-2026-10-27/mobile-expired-review.png), [saved desktop review](evidence/p1-2026-10-27/desktop-saved-review.png). Addresses/names in those captures are synthetic development data.

## Production browser acceptance

On normal HTTPS, the existing authorized Google account completed a guest Bengaluru→Chennai two-passenger journey: alias lookup, price sort, map/list persistence, chosen stops, Google return, ₹1,298 hold, names saved, full reload and release. A separate 390 px mobile Pune→Mumbai journey used a real Resend-delivered email OTP, restored the selected seat/stops, saved a ₹499 reservation, reloaded its passenger and released it. Codes, cookies and contact addresses were never exported to evidence. Both customer records reached version 2, then CANCELLED, with two release events and zero allocations in an independent read-only SQL audit.

A fresh guest mobile browser recovered an invalid cursor through First page, paginated from ₹749 to ₹899, showed an unserved route's empty state and exercised the list/map toggle plus Escape focus recovery. Fresh mobile and authenticated console checks found no warnings/errors. The [production seat-list capture](evidence/p1-2026-10-27/production-mobile-seat-list.png) contains public synthetic catalog data only.

Production contains five cities, three operators, four routes, ten stops, five active service definitions and 156 catalog trips/624 stop snapshots at verification. Runtime can read definitions and publish stop snapshots, but cannot update catalog definitions. The [read-only audit](evidence/p1-2026-10-27/production-audit.json) found seven zero-valued invariants. The [new restore drill](evidence/p1-2026-10-27/recovery.json) matched 26 tables/7,437 rows in 13.9 seconds using one consistent snapshot and a disconnected disposable target; it is not an offsite-backup/RPO guarantee. Production was never a restore destination.

Legacy reads redirect with 308, legacy mutations reject with 421, wrong-origin PATCH rejects with 403 and the API's public hostname returns 404. Native query redaction/private bindings persist. Known-secret scans found no matches in tracked files, new Git history or production client bundles. No credentials, callbacks or DNS records were changed for P1.

## Supporting correctness and release evidence

The final real-Neon integration run passed all 19 checks across 13 files, including the edit/release race and labeled partial-party conflict. A fresh isolated PostgreSQL 18 migration/replay plus two-Worker run passed all 19 integration checks after adding the explicit edit/release race and PATCH origin/body-limit cases. Its contention proof passed too. Exact-source Quality runs [40389175566](https://github.com/jackedengineer/quickbus/actions/runs/40389175566) and [40389455610](https://github.com/jackedengineer/quickbus/actions/runs/40389455610) passed before final acceptance.

The [real-Neon contention artifact](evidence/p1-neon-concurrency-2026-10-27.json) records nine scenarios against the implementation hash, including shared contracts and the PATCH bridge. The final 100-customer burst had one success, six seat conflicts and 93 bounded `RESOURCE_BUSY` responses. Retrying original keys converged to one winner/99 conflicts and one allocation; no dependency retry was required. This proves correctness under that scenario, not sustained throughput.

Additive migrations 0004–0006 preserve existing reservations and old writers. Drizzle's generated 0006 ordering needed referenced unique constraints moved before their foreign keys; the corrected migration applies and replays on isolated PostgreSQL and Neon development, and regeneration reports no schema delta. Complete generated snapshots intentionally exceed the source commit size target.

Owner backfill takes bounded trip locks, inserts only missing menus and preserves customer choices. Release serializes it with owner seeding, repeats it after API deployment and stops before web deployment if it fails. Runtime cannot edit definitions. Recovery audits now check catalog menus, stop references and detail-event versions in addition to allocation/quote invariants. Compatible Worker rollback never reverses customer-data migrations.

## Performance

One local development review interaction trace observed INP 22 ms and CLS 0.02 at 1× CPU without network throttling. This includes a real save and subsequent status refresh. It is a small lab sample, not field data or a production performance claim. Raw traces remain ignored because request bodies may contain customer data. Production desktop LCP was 731 ms (TTFB 587 ms); 390 px/4× CPU/Fast 4G LCP was 839 ms (TTFB 559 ms, load 1,127 ms). Both measured CLS 0. A live search loader took 649 ms at the browser/533 ms in the web Worker; seat-map reads took 398 ms/330 ms in the API, and trip-detail reads 426 ms/398 ms. Nested Server-Timing values and concurrent binding totals must not be added as wall-clock latency.

Throttled interaction samples observed 114, 138, 213 and 43 ms INP; repeated map/list switching measured 82 ms. The one cold 213 ms interaction exceeded the 200 ms target and included 102 ms of layout. Keep that measured cold-layout cost as a follow-up; do not claim every interaction meets the target or infer field percentiles from these samples. Existing feedback uses short opacity/transform/press effects and reduced-motion controls; no animation library was added.

## Remaining boundary

Payments, durable payment jobs, reconciliation, tickets, cancellation/refunds and notifications remain subsequent work. The admin dashboard stays last. No new provider, credential or DNS change is needed for P1.
