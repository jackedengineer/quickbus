# Razorpay test checkout delivery

Started 27 October 2026 from `v0.1.0-preview`. All new payment paths default
disabled. Live Razorpay keys are rejected. Admin remains out of scope.

## Ordered, independently reviewable slices

1. Verify provider contracts with real test-mode requests; add a bounded REST
   adapter and exact-byte signature checks. Do not infer order idempotency from
   the refund endpoint's guarantees.
2. Add PostgreSQL durable jobs with leases, fencing, bounded retries and visible
   failures. Claims commit before business processing; no provider calls in locks.
3. Add payment intent/checkout/payment/refund/inbox/case records and additive
   booking states. Preserve unpaid flows and upgrade/restore compatibility.
4. Prepare checkout with ownership, conditional details version, verified contact,
   full allocation ownership and a post-lock 90-second initiation buffer.
5. Create/reconcile orders outside transactions. An uncertain create is read-only
   recovery; no second create, even when receipt lookup is empty.
6. Apply authoritative captures through one trip-locked finalizer. Confirm once
   or create compensation; never reclaim a released seat. Intake signed callbacks
   and bounded raw webhooks; deduplicate both event IDs and payment IDs.
7. Add hosted test checkout and explicit failure/abandonment/pending/confirmation/
   refund states. Refresh resumes database state. Sandbox labels remain visible.
8. Execute/reconcile full refunds using one immutable key/body. Verify actual
   sandbox success, repeated failure, refresh, duplicates, late captures, refunds,
   wrong-owner requests, tampering and missing callbacks before public enablement.
9. Run fresh two-instance inventory proof, database audits, recovery drill,
   desktop/mobile browser and DevTools acceptance, then guarded production rollout.

Real browser journeys lead acceptance. Targeted written checks cover fault windows
that cannot safely or deterministically be produced through normal checkout UI.
No card, bank or UPI credentials enter KwikBus storage. Store only provider object
IDs, amounts, bounded states and sanitized processing evidence.

## Provider spike — initial observation

The approved account's test-mode API accepted two orders with the same UUID
receipt and returned different order IDs. Immediate filtered and unfiltered list
reads returned zero rows. This contradicts treating documented unique receipts as
an enforced retry guard. It is preliminary evidence, not proof of eventual lookup
behavior; repeat the read and inspect the dashboard before closing T02.

Unknown creation must stay blocked until one exact matching order is found.
Multiple exact matches require a reconciliation case and examination of every
matching order; zero matches never authorizes another POST.

Sources checked 27 October 2026: [orders/create](https://razorpay.com/docs/api/orders/create/),
[orders/list](https://razorpay.com/docs/api/orders/fetch-all/),
[refund replay](https://razorpay.com/docs/api/refunds/normal-refunds-idempotent),
[checkout/signatures](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/).

## Local acceptance completed

The original provider spike is now resolved in [the provider contract](provider-contract.md):
delayed lookup found both duplicate-receipt orders. No receipt uniqueness assumption
is used. Real hosted success/reload, explicit bank failure, explicit replacement,
wrong-owner rejection and release-before-capture compensation have passed locally.
The full ₹749 sandbox refund reached processed; replay returned the same refund ID
and one refund total. Full reload preserved refunded/released state.

The real Neon proof passed nine scenarios across two independent Workers,
including 100 last-seat contenders (one winner, 99 final conflicts). The local
financial/inventory audit returned zero across 17 invariants. Isolated CI also
passed the integration suite and its independent two-Worker contention run.
[Sanitized evidence](evidence/payments-2026-10-27/local-acceptance.json).

During actual usage, older recovery jobs delayed a new checkout's request wakeup.
Request-triggered work now claims only the trusted checkout/inbox resource; cron
handles the global queue. Successful settled orders back off to hourly reads.
Browser polling continues after release while checkout/refund exposure remains,
and authoritative terminal states close a stale hosted overlay.

An account-wide limit admits ten new attempts per ten minutes, under a customer
`FOR NO KEY UPDATE` lock taken before the trip lock. Stronger FOR UPDATE deadlocked
with the idempotency foreign key's KEY SHARE; the real two-connection boundary
check exposed this and now passes. Reusing an HTTP key or resuming an unresolved
attempt consumes no new slot. Each logical intent still permits at most ten attempts.

Database runtime grants preserve immutable intent/amount/provider/event identity;
state transitions alone remain writable. Release and recovery audits check money,
fulfillment, allocations, refunds and durable recovery linkage. Failed intake
cannot ACK, and payment heartbeat/backlog/failure/case signals feed health checks.
Production enablement remains test-only; live keys are rejected in every adapter.

## Production staging baseline

`v0.2.0-rc.1` / `fe18c70` deployed after exact-revision Quality run
[40469809338](https://github.com/jackedengineer/quickbus/actions/runs/40469809338).
The API/web understand payment states and have the approved test credentials, with
checkout admission disabled. A real production browser search/reserve/release
showed the explicit unavailable state. All five HTTP probes passed; legacy reads
redirect 308, legacy mutations reject 421, wrong-origin mutations reject 403 and
the API workers.dev endpoint stays 404. All 17 independent invariants were zero.

Compatible disabled rollback baseline: API
`0b893555-0000-486c-9c73-f3a5461d0aa8`, web
`4bb3c9dd-7ca2-4a8d-80ff-754a35c50a0c`.
[Deployment evidence](evidence/payments-2026-10-27/staged-release.json).
Public sandbox enablement is the next deployment; live money stays unavailable.

## Production-only hosted-frame failure

The first enabled HTTPS browser attempt created one provider order but displayed
an empty hosted frame. Its document remained about:blank. The official SDK submits
a form into that initially blank frame, which inherits the parent document's CSP;
allowing frame-src alone was insufficient with form-action restricted to self.
Local HTTP acceptance did not exercise the production HTTPS policy.

New admission was paused by deploying the compatible disabled API version. The
web fix adds only https://api.razorpay.com to form-action; nonce scripts, fixed
frame/connect hosts, frame-ancestors, HTTPS, Origin and private API protections
remain. Acceptance requires repeating the actual HTTPS hosted flow after this
narrow change, rather than treating a static header check as a working payment.

The CSP fix passed actual production hosted-frame rendering in both the in-app
browser and Chrome. A deliberate mock-bank Failure reached the signed production
inbox and FAILED attempt; explicit replacement captured and confirmed once after
reload/resume. Full reload retained confirmation, one allocation and one
confirmation event. The original failed payment remained failed.

Chrome also exposed a same-document SDK reuse failure: reopening the next attempt
could leave an empty frame, while full reload/resume used the same durable order
successfully. Checkout now resets its document after authoritative terminal state
or a completed dismissal hint. No new order is inferred from that reset. Callback
identity/mount guards suppress old modals affecting another reservation. Passenger
details are already frozen; all recovery state is database-backed. This behavior
must pass an actual failure→retry journey after deployment before UI acceptance.

The launch is now explicit: Continue prepares the durable order and preloads the
public SDK; Open Razorpay test checkout opens the READY order from a direct user
click. This removes the delayed automatic launch that was unreliable in Chrome.
A reopened review always reads the existing attempt; it does not create another
order. After provider dismissal or authoritative terminal state, a guarded fresh
document resets the SDK. Switching reservations also remounts payment UI by ID.


## Production acceptance — 27 October 2026

Exact source `40077a1` passed Quality run
[40474259388](https://github.com/jackedengineer/quickbus/actions/runs/40474259388)
and was deployed with test checkout enabled. The actual 390×844 touch Chrome
journey used delivered email OTP, database search/reserve/details, explicit bank
Failure, replacement checkout without manual reload, bank Success and restored
confirmation. Desktop Chrome passed failure/retry/capture and full reload too.
The in-app mobile view rendered hosted checkout and verified cancellation; its
mock-bank popup was not exposed to automation, so controlled outcomes used Chrome.
No UPI collect or live-bank result is claimed.

For a controlled late capture, the original Chrome checkout tab was set offline
with per-page DevTools emulation while the separate mock-bank window stayed online.
The same owner's in-app session released the reservation before bank Success;
a transient release error safely retried with its existing command key. With zero
allocations and no browser verification callback, signed provider events recovered
the capture and issued one full ₹749 refund. The provider reached processed,
repeat submission of the immutable refund key returned the same ID, and the
provider listed one refund. Refund state appeared before the original tab was
reconnected and survived its reload. The booking stayed CANCELLED with zero
confirmation events. Network emulation was restored after the experiment.

The read-only production audit found zero violations across all 17 inventory and
financial checks. Runtime grants reject amount/identity/evidence changes while
allowing required state transitions. A fresh consistent production snapshot
restored 33 tables / 7,613 rows into an isolated disposable target with matching
schema and invariant audits; production remained online.

[Production browser/provider/SQL evidence](evidence/payments-2026-10-27/production-acceptance.json),
[recovery evidence](evidence/payments-2026-10-27/recovery.json).
The earlier staging section is historical; public sandbox checkout is now enabled.
The payment-aware disabled rollback baseline remains the compatible fallback.
Full paid cancellation, ticket delivery and admin remain future slices.
