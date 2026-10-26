# P1 customer journey

Scope: finish catalog/stops → server search → passenger review → customer usability. Keep the live unpaid preview, existing bookings, Google/email OTP, native URL-query redaction and private API intact. No admin surface, payment integration or new service/credential is part of this batch. Use existing production rollout safeguards after browser acceptance. All demo entities are synthetic rows in PostgreSQL, never client-side catalog/availability fixtures.

## 1. Catalog and publication (T08/T10/T11)

- [ ] Add normalized cities/aliases, operators, directional routes, layouts/seats and city stops. Extend existing service definitions with nullable catalog references for expand/contract compatibility.
- [ ] Bootstrap three explicitly synthetic operators, five cities and four directional routes through versioned owner tooling. Existing service IDs, trips, fares, quotes and reservations remain intact. Runtime cannot edit catalog definitions.
- [ ] Persist service stop definitions (pickup/drop role, sequence, departure-relative minutes); validate cities, ordered times, complete seat layout and stop endpoints before publication.
- [ ] Publish trip, every seat and every immutable stop snapshot atomically. Unique service/departure identity makes repeats/overlap safe. Add catalog references to existing trips and populate missing stop snapshots with bounded, trip-locked owner backfill; never replace existing snapshots.
- [ ] Real browser shows database city suggestions and trip/stop information. Real SQL verifies bad layouts/stops and injected seat/stop failures cannot leave partial publication.

The existing service/seat definition tables remain the fare source during migration. Normalized layout geometry is reusable; service seats attach fares to that geometry. Existing snapshot text is retained for history; new publication copies catalog labels once. Catalog management uses seed/import tooling, not an admin API.

## 2. Server search (T09)

- [ ] Public input/output contracts validate city IDs/aliases, India service date, 1–4 passengers, bounded sort/page size and filter-bound keyset cursors.
- [ ] PostgreSQL filters sellable trips by route/date and advisory live availability. Stable departure/price plus UUID ordering; no per-card database requests or all-timetable filtering in the browser.
- [ ] Preserve existing human-readable route links and the bounded unfiltered V0 read while updating the web app to queried search. Unknown cities, same-city input, malformed dates/cursors and unserved routes have useful, explicit outcomes.
- [ ] Browser proves suggestions (including aliases), sort/pagination, overnight dates, empty/error states, reload/back and mobile layouts against persisted data.

Search availability remains advisory: the existing trip lock and allocation constraints decide the hold. Cursor input never overrides server filters. No session or private booking data is cached or placed in URLs.

## 3. Reservation and passenger review (T14/T15)

- [ ] Seat drawer shows published pickup/drop snapshots and validates an ordered pair belonging to that trip. Hold quote/deadline/idempotency behavior stays unchanged.
- [ ] Add booking version, optional selected stop IDs, per-seat passenger name and server-derived verified contact email; optional normalized phone. Add composite stop/booking constraints and a versioned details-save audit event.
- [ ] Owned details command requires If-Match and a stable intent key. Lock the trip, read DB time after locking, reject terminal/expired/stale edits, validate exact passenger-seat coverage and commit details/version/event/replay together.
- [ ] Add customer reservation review with complete fare/stop/date/name/contact information, recoverable validation, deadline across reload/focus, release and expiry states. Preserve drafts only in page memory; never store passenger/contact data in URLs or browser storage.
- [ ] Existing V0 holds may lack stops/names: show incomplete details and require completion before marking review ready. Do not fabricate historical choices. Old hold clients can still reserve seats; missing choices remain explicit, incomplete data.
- [ ] Keep payment unavailable. Display the 90-second payment-start rule near the deadline; a future payment command must enforce it with DB time before checkout is introduced.

Names are 2–100 trimmed Unicode characters without control characters. The account's verified email is the contact email, not a client-authoritative email. Phone is optional, stored in normalized international form. Do not collect DOB, government ID, gender or saved passenger profiles.

## 4. Customer acceptance and release

- [ ] Browser-first desktop/mobile journey: alias search → trip/stops/seats → login restoration → hold → names/contact review → save → reload → edit/release. Also exercise keyboard/focus, interruption, validation, stale tabs and natural expiry.
- [ ] Chrome DevTools: fresh console/network, normal and throttled interactions, small widths, reduced motion and restrained existing transitions. Publish sanitized evidence only.
- [ ] SQL supplements browser checks for cross-trip stop IDs, ownership, atomic publication, version/idempotency races, release/expiry races, migrations and least-privilege runtime behavior. Re-run real-Neon contention after mutation changes.
- [ ] Reviewed commits aim for 300–400 changed source lines per coherent slice. Generated complete Drizzle snapshots may be larger. Build/type/lint/CI, exact source proof, secret scan and guarded production rollout remain required.
- [ ] Reconcile backlog, source/deployment evidence, operating docs and changelog. Keep partial full-lifecycle tasks open; admin remains the final roadmap slice.

## Migration policy

Expand first; nullable catalog/detail fields keep older deployed code valid. Backfill in deterministic bounded batches and switch consumers only after validation. No schema contraction in this batch. Rollback means compatible Worker versions; never drop new booking/customer data or restore over production. Test additive migration/replay and old read compatibility on isolated PostgreSQL before the production operator applies it.
