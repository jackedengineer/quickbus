# Razorpay sandbox contract — 27 October 2026

Scope: the approved account's **test** credentials, INR, Standard Checkout,
server-created orders and full compensation refunds. No live credentials, real
charges, bank logins, stored cards or account-wide capture-policy changes.

## Observations that affect correctness

| Boundary | Actual observation | KwikBus decision |
|---|---|---|
| Order creation | Two POSTs with one UUID receipt returned two different order IDs. Immediate list reads found neither; a later exact-receipt read found both. | One submission per local attempt. Never repeat an uncertain create. Receipt lookup can bind one exact result; zero is inconclusive and multiple results require review. |
| Unpaid order response | A list read returned `amount_paid: null`; create returned zero. | Validate both without inventing a successful payment. |
| Runtime transport | Node accepted `redirect: 'error'`; Workers rejected that option before network I/O. | Use manual redirects and reject every non-success response, preserving credentials on the fixed provider host. |
| Declines | Selecting Failure on the hosted mock-bank page produced a provider-verified failed payment. A sample error card alone did not deterministically select the simulator's outcome. | Retry only after authoritative failure. Do not label an attempted card as a proven decline without fetching its state. |
| Replacement | A failed checkout followed by the UI's explicit Retry created attempt two under the same logical intent. | New HTTP keys cannot replace an unresolved order. The account budget covers new attempts across reservations. |
| Successful capture | Hosted checkout produced an exact INR capture; a full app reload retained the confirmed booking and seat ownership. | Browser success is only a signed hint. Authoritative provider fetch plus the trip-locked finalizer confirms seats. |
| Late capture | Seats were released in a second real app tab before Success on the mock bank. Capture remained CANCELLED, with zero allocations and zero confirmation events. | Create one full compensation refund; never reacquire released seats. |
| Refund | The sandbox refund first appeared pending, then processed for the full ₹749. A same-key, same-body replay returned the same provider refund ID; list count remained one. | Persist the immutable refund UUID/body before submission. Mark refunded only from a verified provider observation. |

These are observations of this account and date, not universal provider guarantees.
The initial spike was intentionally outside booking inventory. Its two unpaid
orders remain provider-side evidence; they were never presented as customer orders.

## Documented contract and conservative recovery

Razorpay's [order API](https://razorpay.com/docs/api/orders/create/) describes a
receipt as unique. Our observed duplicate acceptance means it cannot be the
mutation retry guard. An exact receipt remains useful for discovery. Paginated
lookup is bounded; truncation, malformed responses and network failures remain
unknown rather than proving absence.

The [idempotent refund API](https://razorpay.com/docs/api/refunds/normal-refunds-idempotent/)
uses `X-Refund-Idempotency` and requires the same key and request body on replay.
The reviewed page does not establish a retention horizon for that guarantee.
KwikBus submits once automatically and then uses read recovery after an uncertain
response. It does not issue a replacement key or blindly resubmit after a crash.
An unresolved refund stays visible as a review case. The real replay above proves
an immediate replay only. It does not prove indefinite provider key retention.

The [Standard Checkout guide](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/)
requires server order creation and signature verification. KwikBus additionally
fetches the payment/order, checks amount/currency/key/receipt and inventory under
one trip lock. An authorized payment is not a capture. An SDK timeout, close,
missing callback or success animation never determines financial state.

Webhook HMAC covers exact raw bytes. Six enabled events reach the canonical
webhook: payment authorized/failed/captured and refund created/processed/failed.
Intake stores only object IDs, event type/hash and timestamps, then acknowledges
after the inbox/job transaction commits. Repeated event IDs deduplicate; changed
bytes with the same valid identity create a case. Different event IDs for one
payment converge on its unique provider payment ID.

## Evidence and limits

[Sanitized local acceptance](evidence/payments-2026-10-27/local-acceptance.json)
records browser/DB/provider results separately. Fault checks cover lost responses,
crashes, stale leases, replay, altered signatures and allocation races that cannot
be selected deterministically in the hosted simulator. Browser testing leads
acceptance, but does not establish distributed transaction correctness alone.

Production acceptance and Worker versions are recorded separately after rollout.
A test-mode refund is simulated money, not evidence of live-bank settlement time.
Customer paid cancellation, ticket notification delivery, operator trip cancellation
and an admin console remain later tasks. Live-money enablement requires a separate
review and is rejected by the current adapter.
