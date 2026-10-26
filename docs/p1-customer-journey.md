# P1 customer journey

Implementation is complete on `codex/p1-customer-journey`; local browser and real-Neon acceptance passed. Production rollout and its browser/performance checks are still pending. The live site remains the P0 baseline until the guarded deployment completes.

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

## Supporting correctness and release evidence

The final real-Neon integration run passed all 19 checks across 13 files, including the edit/release race and labeled partial-party conflict. A fresh isolated PostgreSQL 18 migration/replay plus two-Worker run passed all 19 integration checks after adding the explicit edit/release race and PATCH origin/body-limit cases. Its contention proof passed too. Exact-revision GitHub CI must pass before rollout.

The [real-Neon contention artifact](evidence/p1-neon-concurrency-2026-10-27.json) records nine scenarios against the implementation hash, including shared contracts and the PATCH bridge. The final 100-customer burst had one success, six seat conflicts and 93 bounded `RESOURCE_BUSY` responses. Retrying original keys converged to one winner/99 conflicts and one allocation; no dependency retry was required. This proves correctness under that scenario, not sustained throughput.

Additive migrations 0004–0006 preserve existing reservations and old writers. Drizzle's generated 0006 ordering needed referenced unique constraints moved before their foreign keys; the corrected migration applies and replays on isolated PostgreSQL and Neon development, and regeneration reports no schema delta. Complete generated snapshots intentionally exceed the source commit size target.

Owner backfill takes bounded trip locks, inserts only missing menus and preserves customer choices. Release serializes it with owner seeding, repeats it after API deployment and stops before web deployment if it fails. Runtime cannot edit definitions. Recovery audits now check catalog menus, stop references and detail-event versions in addition to allocation/quote invariants. Compatible Worker rollback never reverses customer-data migrations.

## Performance

One local development review interaction trace observed INP 22 ms and CLS 0.02 at 1× CPU without network throttling. This includes a real save and subsequent status refresh. It is a small lab sample, not field data or a production performance claim. Raw traces remain ignored because request bodies may contain customer data. Production desktop and throttled mobile measurements are pending.

## Remaining boundary

Payments, durable payment jobs, reconciliation, tickets, cancellation/refunds and notifications remain subsequent work. The admin dashboard stays last. No new provider, credential or DNS change is needed for P1.
