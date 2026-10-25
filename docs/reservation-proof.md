# Seat reservation correctness proof

The first reservation slice runs through two independent Wrangler/workerd API instances and real Neon PostgreSQL 18. HTTP requests authenticate synthetic customers through Better Auth cookies. The database is the inventory authority; there is no in-memory seat lock and no payment code.

The [sanitized run artifact](evidence/concurrency-2026-10-25.json) records its timestamp, runtime role, exact outcome counts, and a SHA-256 digest of the listed API/backend/database source files plus lockfile. It is generated evidence, not a hand-edited result. The full PRD is larger than this slice: published snapshots currently come from a guarded development seed; editable catalogs, stop snapshots, admin publication, payments, and jobs remain later tasks.

## Protocol exercised

1. Claim `(principal, route, idempotency key)` and compare the canonical request hash. The seat-label list is sorted before hashing.
2. Acquire the trip row's `FOR UPDATE` lock with a two-second lock timeout and five-second statement timeout.
3. Read `clock_timestamp()` after the lock, then retire expired bookings and their allocations under that same lock.
4. Check the sales cutoff, one pending hold per customer/trip, every seat, and the acknowledged fare.
5. Insert the booking, immutable item quotes, all allocation rows, and the event. Persist the HTTP response in the same transaction.
6. Commit before returning success. A transaction failure leaves none of those writes. A safe replay returns the original result.

The allocation primary key is `(trip_id, seat_label)` and its composite foreign key names the corresponding booking item. A partial unique index enforces one HELD booking per customer/trip. Every release uses the same trip lock and ownership check. No external network call occurs inside this critical transaction; SQL round trips to Neon are its only I/O.

## Scenarios

| Scenario | Required result |
|---|---|
| 100 customers simultaneously request the last seat through two API instances | Exactly one successful booking/allocation. Every other final result is `SEATS_UNAVAILABLE`; initial bounded busy responses are explicitly counted and retried with the original key after the burst. |
| 12 simultaneous requests with the same key through both instances | One booking, one HELD event, two allocation rows, identical successful booking identity in all responses. |
| Overlapping two-seat parties | One whole party succeeds; the other receives no seats or items. |
| Different keys from one customer for different seats on one trip | One hold succeeds; the other receives `ACTIVE_HOLD_EXISTS`. |
| Expired two-seat hold without running a scheduler | Its allocations are retired once; the next customer can claim one of those seats, and the unrequested old seat is free. |
| Sales deadline crossed while waiting for the lock | `SALES_CLOSED`, with no booking, items, allocations, or event. |
| Lock held beyond timeout, followed by same-key retry | Bounded `RESOURCE_BUSY`, rollback of the first command claim, then one successful booking. |
| A database trigger raises during allocation after booking/items were inserted | Booking, items, allocation, event and command claim all roll back. Removing the fault permits the same key to succeed. |
| Independent final SQL audit | No missing allocation for a HELD item; no allocation belonging to a terminal booking. |

Focused integration checks additionally cover inverse seat ordering, changed payload under an existing key, cross-customer reads, anonymous/foreign-origin mutations, release replay, transaction rollback, restricted runtime privileges, single-use hashed links, and SSR session isolation. A real idle-connection termination also verifies safe error reporting and pool recovery. The expiry-while-waiting check uses `pg_blocking_pids` to observe the actual wait before advancing the old hold's deadline.

## Reproduce

Follow the README's development setup. Keep `pnpm dev` and `pnpm dev:peer` running, then execute:

```sh
pnpm test:integration
pnpm test:contention
```

Fixtures require explicit local flags and owner access only for setup/cleanup/fault injection. API requests use the DML-only runtime role. The runner drains parallel requests before cleaning up its own rows. The JSON artifact is written under ignored `artifacts/local/`; copy a reviewed, successful result into this evidence directory when updating the record.

## Interpretation and limits

This proves seat ownership and replay invariants for the implemented unpaid-hold protocol. It does not prove payment semantics or production throughput. Under the free development database's hot-trip burst, many requests hit the deliberate two-second lock bound. The artifact distinguishes these initial busy results from the later safe retry outcomes. A production latency SLO requires separate measurement and tuning; timeout recovery must keep its original key.

Earlier harness iterations exposed a five-second test timeout shorter than Neon wake-up plus transaction work, a synchronized retry storm, and an overly broad retry helper that retried the intentionally injected failure. The harness now uses a 30-second integration deadline, bounded jittered same-key retries, paced recovery after the simultaneous burst, and a single attempt for the intentional fault. One intermediate recovery run returned an unexpected result before sanitized status counts were recorded; the final runner records aggregate codes and counts dependency retries. These harness fixes do not relax the one-winner, no-partial-party, or all-writes-rollback assertions.

Payments stay disabled. Complete the remaining identity/MFA review and provider contract spike before adding checkout, and re-run this proof as inventory and booking states evolve.
