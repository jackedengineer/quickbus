# QuickBus quality and operations

## Release definition

A release is ready when its agreed product behaviors work, the inventory/money invariants survive adversarial tests, and deployment/recovery have evidence. A green unit-test suite alone is insufficient. The design pack is not that evidence; the application has not been implemented or benchmarked yet.

## Verification layers

| Layer | Tool / environment | What it must prove |
|---|---|---|
| Pure policies | Vitest, deterministic clock inputs | Money totals, cutoff boundaries, transition guards, quote comparison, event ordering |
| Database | Real PostgreSQL matching the selected Neon major | Constraints, rollbacks, lock order, FK ownership, duplicate keys, deadlocks/timeouts |
| HTTP contracts | Express integration tests with real DB | Validation, CSRF/authz, idempotent replay, preconditions, errors, pagination |
| Provider adapter | Controlled fake plus Razorpay test mode | Exact payloads/signatures, duplicate/out-of-order events, ambiguous calls, refund key reuse |
| Browser | Playwright across desktop/mobile viewports | Search-to-ticket, reload/back, auth return, expiry, failure recovery, cancellation |
| Accessibility | Automated scan plus keyboard/screen-reader review | Seat-map alternative, focus, labels, status/timer announcements, contrast |
| Load/fault | k6 and controlled process/provider fault injection | Invariants under multiple instances, crash windows, bounded queues and latencies |
| Operations | Staging deployment and restore drill | Migration safety, rollback, monitoring, backup recovery, secret isolation |

Use a controlled clock seam for unit policies. Integration deadline tests should set existing deadlines or use barriers around lock acquisition, not globally fake PostgreSQL time. Avoid flaky sleeps as the synchronization mechanism.

### Mandatory concurrency and failure scenarios

1. **Last seat:** 100 concurrent customers via two API processes target one free seat. One winner; no other successful claim. Track explicit busy/timeouts separately from business conflicts. Query the database after the run.
2. **Overlapping parties:** requests `[1A,1B]` and `[1B,1C]`; exactly one party wins, no partial losing allocation. Repeat with inverse input order.
3. **Same intent:** 100 concurrent copies of the same key/body return one booking identity/deadline. Reuse that key with changed seats/amount/resource: reject without mutation.
4. **One customer/trip:** different keys concurrently target different seat sets for the same customer/trip. At most one pending reservation; return the existing one safely.
5. **Expiry race:** put a request behind the trip lock until after expiry; verify the post-lock DB time prevents confirmation. Test exact boundary equality.
6. **Late capture:** expire A, let B acquire its seat, deliver A's capture. B retains the seat; A remains terminal and gets exactly one compensation intent.
7. **Missing browser/webhook:** lose both callback and initial webhook, then run reconciliation. A valid capture resolves once or compensates if too late.
8. **Semantic duplicates:** deliver duplicate event IDs and different event IDs for the same capture in random order. One transition/event/refund maximum; captured status cannot regress.
9. **Unknown order creation:** provider creates order but response is lost. Restart worker; it reconciles the same intent or opens a case, and never blindly issues another create.
10. **Lost DB commit acknowledgment:** simulate response/connection loss around hold commit; retry same key and verify the correct single result.
11. **Cancellation race:** race eligible customer cancellation and capture; test both lock orders. No cancelled booking becomes confirmed afterward.
12. **Trip cancellation:** race hold/capture with admin cancellation, kill/restart the drain worker, and deliver captures after the drain. Every affected booking is terminal; every captured fare is refunded or visible in review.
13. **Refund ambiguity:** refund succeeds externally but response is lost. Retry/reconcile with the same provider key; at most the captured amount is refunded.
14. **Stale worker:** lease expires while worker A calls a provider; worker B takes over. Stale completions cannot overwrite newer state, and unknown non-idempotent effects require reconciliation.
15. **Isolation/security:** customer A cannot read/cancel/pay customer B's booking; SSR caches cannot leak private data; forged/mutated webhook bodies do not create observations.
16. **Mismatch:** order ID, environment, amount, currency, or payment ownership differs. No ticket; protected evidence and a visible case.
17. **Rollback:** inject failure after the first item/allocation/outbox write. All associated writes roll back; no orphaned inventory or notification event.
18. **Unrelated trips:** a contended departure does not block another departure's mutations through an application-wide mutex or exhausted pool.

Use model-based/property tests to generate legal/illegal sequences of hold, expiry, failure, capture, duplicate capture, cancel, and refund observations. Execute the meaningful sequences against the real database as well as pure policy functions. A unit model that merely mirrors the implementation is not sufficient.

### Post-run invariant audit

The audit independently checks:

- Every allocation maps to an existing item and same-trip seat.
- Every `CONFIRMED` booking owns precisely its item set and points to a matching captured payment.
- `EXPIRED/CANCELLED` bookings have no current allocations.
- No payment is the fulfillment source for multiple bookings.
- Every captured payment is fulfilled, refund-covered, or in an owned unresolved case.
- Each refund is tied to its actual captured payment and total processed/requested compensation does not exceed capture.
- No outbox transition has multiple semantic notification/compensation events.

The allocation PK makes one class of duplication impossible, but these queries catch other bugs. Store scenario seeds and raw run artifacts so a reviewer can reproduce failures.

## Performance and capacity plan

Start with a synthetic dataset of 10,000 future trips, approximately 400,000 seat rows, 100,000 historical bookings, and a mix of active/expired claims. Keep realistic route skew; do not distribute all writes uniformly and call it a hot-trip benchmark.

Run a warm 15-minute baseline at 50 requests/second with approximately 90% browse/status reads and 10% mutations on a controlled mix of trips. Separately run the 100-request last-seat burst, a popular-trip sustained-write test, a two-instance run, and a worker backlog drain. Report external-provider simulation latency explicitly. These are starting workloads, not a claim that the selected infrastructure already supports them.

Targets: warm search p95 <500 ms; uncontended hold/detail/cancellation p95 <750 ms; non-contention server errors <0.5%. Report p99, lock waits/timeouts, DB pool waits, CPU/memory, Neon compute, connection totals, throughput, business conflicts, and invariant results. Cold-start/provider delays are separate measurements, not excluded silently.

Start each process with a small bounded pool, for example API max 5 and worker max 3, then budget the sum across replicas, migrations, monitoring, and database capacity. No connection per request without pooling. Use query plans to guide indexes; fix N+1 reads and overfetching before adding caches.

If trip lock contention fails the target, first shorten the transaction and expiry batch, then reconsider seat-level locking with a written equivalent protocol. Do not loosen correctness checks to improve a benchmark.

## Service objectives and alerting

| Signal | Initial objective / alert trigger | Response |
|---|---|---|
| API availability | Pilot 99.5% monthly; alert on sustained error/latency burn | Check deploy, host, DB/pool health |
| Payment/inventory invariant | Zero violations; immediate alert | Stop new sales for affected trip, preserve evidence, reconcile |
| Inbox age | Healthy processing normally <60 s; alert oldest >2 min | Check worker/provider/DB; replay safely |
| Expiry backlog | Healthy cleanup normally <60 s; alert >2 min | Restart/drain; holds remain protected by transactional checks |
| Unknown payment | Check within 1 min; escalate unresolved >5 min | Reconcile stored intent; do not charge again |
| Outbox/job backlog | Alert age/failed attempts rather than row count alone | Inspect failing handler and provider rate limits |
| Refund | Alert request not submitted >5 min or pending beyond provider's actual expected window | Fetch provider state; assign case |
| Worker heartbeat | Alert no heartbeat >2 min | Restart, inspect leases, reconcile in-flight effects |
| DB pool/locks | Sustained waits or lock timeouts above baseline | Reduce contention/traffic, inspect long transactions |

Exact windows are initial operating settings to tune from evidence. Provider completion time is not under the application's sole control. Every alert needs a recipient and a tested runbook before the public release.

Structured logs carry request/trace ID, route template, safe resource IDs, outcome code, duration, job ID, and attempt count. Keep passenger fields, session cookies, magic-link tokens, provider secrets, card data, and authentication screens out of logs/traces. Metrics use bounded labels; booking/user IDs belong in logs, not high-cardinality metric labels. Record trace links across outbox/job transitions.

## Security and privacy baseline

- Use established auth/session primitives; configure magic-link token hashing explicitly rather than relying on the library's plain-storage default, and verify concurrent single-use/expiry behavior in the pinned version. Restrict callback origins/return paths. Admin roles are provisioned outside signup; require MFA and recent authentication for privileged operations. [Magic-link configuration](https://better-auth.com/docs/plugins/magic-link).
- Enforce ownership server-side on every private endpoint and worker command. Treat provider observations as untrusted until validated. [Express production guidance](https://expressjs.com/en/advanced/best-practice-security/).
- Apply TLS, Secure/HttpOnly host-scoped cookies, CSRF protection for cookie-authenticated commands, strict trusted proxy settings, security headers, and a tested CSP that allows only the necessary checkout resources.
- Never collect/store PAN, security codes, or bank OTPs. Hosted checkout reduces card-data handling; do not claim it removes all security/compliance obligations.
- Parameterize SQL, validate sizes and allowlisted enums, reject unexpected resource ownership, and rate-limit login, hold, payment-initiation, callback, webhook, and admin routes appropriately.
- Count abusive attempts in ingress or a separate committed rate-limit transaction before domain work. Do not roll back admission counters with a failed booking transaction. Distributed API instances must share the effective quota, not independent in-memory buckets.
- Use least-privilege runtime DB roles, separate migration credentials, environment-isolated provider keys, secret rotation, dependency scanning, and redacted error handling.
- Define a data retention/deletion job and minimal consented telemetry. Synthetic seed data only in public demos. Retain unresolved financial evidence while removing unnecessary personal payloads under policy.

This is an application-specific baseline. No formal security audit, compliance certification, or legal approval has been performed as part of writing the plan.

## CI and deployment gates

For each PR: frozen-lockfile install → lint/types → unit tests → build → real-Postgres migration/contract/integration suite → relevant browser/accessibility tests. Run the bounded contention suite whenever booking/DB/payment code changes. Run longer fault/load exercises on a dedicated staging environment and attach results before release. Scan dependencies/secrets and verify module import boundaries.

Do not cache environment-sensitive build outputs without declaring the inputs. Do not cache test results that depend on a mutable external database. Preview databases and payment credentials must be isolated.

For release: validate environment → apply reviewed backward-compatible migration once → deploy immutable images → health/synthetic smoke → observe errors/queue age → retain rollback image. Handle SIGTERM by stopping admissions/claims, finishing bounded DB transactions, marking ambiguous external work for reconciliation, and exiting within the host grace period.

## Runbooks

### Payment captured without a ticket

Locate the payment by stored provider/environment ID, not by customer-supplied amount. Fetch authoritative provider state. Read the booking timeline and allocation ownership. Invoke the common reconciliation path: confirm only if still eligible, otherwise ensure compensation. Never manually set a booking to confirmed or overwrite another customer's allocation. Assign an owner if unresolved.

### Suspected oversell or invariant failure

Close new sales on the affected trip, preserve DB/provider/trace evidence, and identify the committed allocations/payments. Reconcile legitimate inventory and compensate affected captures through guarded commands. Fix the protocol/test before reopening. Do not hide the inconsistency by deleting historical rows.

### Worker outage

Restore the worker, inspect oldest inbox/outbox/jobs and expired leases, and reconcile in-flight payment/refund operations. Known idempotent jobs may replay using their existing business keys. An interrupted order-create call is unknown, not automatically retryable. Lazy hold cleanup still protects availability while the worker is down.

### Provider outage

Disable new checkout initiation when failures persist; retain existing intents and visible pending states. Continue safe browsing/holds only if their deadlines can be honored, otherwise temporarily pause new holds. Do not replace providers or payment intents during an unresolved attempt. Reconcile after recovery.

### Restore or bad migration

Stop new booking/payment mutations, restore into an isolated database using the selected Neon recovery mechanism, verify schema and invariants, then reconcile provider events/payments/refunds since the recovery point before reopening sales. A restored database may lack a payment that already happened externally. Database restore alone is not financial recovery.

Test proposed RPO ≤1 hour and RTO ≤4 hours on the purchased plan. Keep recoverable backups in an approved access boundary and rehearse recovery without copying production PII into previews. If the plan cannot meet the target, update the service promise before launch.

## Portfolio evidence checklist

- A 5–8 minute walkthrough of the core customer/admin journey using synthetic data.
- A two-client last-seat collision and the resulting database invariant report.
- A late capture that produces a refund without displacing the newer booking.
- A duplicate-webhook and worker-crash recovery demonstration.
- Exact environment/version manifests and raw benchmark outputs with honest limitations.
- CI links, schema migration/ERD, ADRs, a trace spanning API→outbox→worker, and a restore-drill note.

Avoid claiming millions of users, zero downtime, or a measured SLO from a short synthetic run. A clear explanation of a deliberately bounded design is stronger evidence of judgment.
