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
