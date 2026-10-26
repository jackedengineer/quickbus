# KwikBus product requirements

**Version:** proposal 1 · **Date:** 25 October 2026 · **Owner:** portfolio developer

**Delivery update, 27 October 2026:** the unpaid V0 is live on `kwikbus.jacked.dev`, with Google/email OTP, normalized catalog/stop publication, server-side search/pagination, accessible map/list seats, party holds/release, conditional passenger/contact review and operational hardening. The full paid lifecycle below remains the target product. Admin authoring/dashboard is explicitly last, after customer/P0/P1 work; synthetic inventory is persisted in PostgreSQL and served through the API. [Current backlog](tasks/todo.md), [production evidence](docs/p1-customer-journey.md).

## Objective

Help a traveler find a direct bus, reserve specific seats, pay, obtain a ticket, and cancel an eligible booking with clear status at every stage. Demonstrate complete engineering ownership: useful UI, accessible interaction, sound relational modeling, safe concurrent transactions, external-service recovery, testing, deployment, and operation.

The final portfolio claim should be specific: “I built and tested a booking system that prevents duplicate allocation and recovers payment failures.” The current demonstrated claim covers concurrent unpaid reservations and operational recovery; payment recovery is not implemented. Production readiness is established by release evidence, not by the number of technologies used.

## Users and operating model

- **Traveler:** compares departure time, total seat fare, bus type, and boarding location; needs confidence about reservation and payment status.
- **Returning traveler:** retrieves tickets and cancellation/refund progress from a verified account.
- **Administrator:** creates a small inventory, publishes trips, stops sales, cancels trips, and resolves payment exceptions.
- **Reviewer:** uses seeded data and sandbox checkout, then inspects reproducible tests, architecture decisions, and operational evidence.

KwikBus is the authoritative seller of its curated inventory. Operator names are catalog records, not independently integrated suppliers. No external aggregator can sell these seats in v1. Adding a real supplier would invalidate local-only availability guarantees and requires a separate integration design.

## Scope

### Required for the first release

| ID | Capability | Minimum useful behavior |
|---|---|---|
| C1 | Search | Origin, destination, local departure date, passenger count; valid URL state; empty/error/loading states |
| C2 | Compare | Departure/arrival dates, duration, operator, AC/non-AC, fare, available count; price/time sorting and a few useful filters |
| C3 | Select seats | One 2+2 seated layout; visible seat labels, availability legend, keyboard support, one to four seats |
| C4 | Secure checkout | Verified-email session, boarding/drop selection, one adult name per seat, contact details, immutable quote and hold deadline |
| C5 | Pay and recover | Hosted Razorpay test checkout, pending/failure/success states, reload recovery, duplicate-event handling, late-payment compensation |
| C6 | Retrieve | Owned booking list, booking detail, printable ticket, clear payment/refund status |
| C7 | Cancel | Entire-booking cancellation, eligibility preview, full refund when eligible, durable refund tracking |
| C8 | Operate | Draft/publish a trip, close sales, cancel a trip, view booking/payment timeline, retry safe jobs and inspect exceptions |

Use 3 synthetic operators, 5 cities, 4 directional routes, 2–4 origin/destination stop choices, a 30-day sale window, and roughly 40 seats per trip for the demo. These are seed targets, not an external data feed. A separate synthetic load fixture can contain 10,000 future trips.

### Deliberately excluded

Round trips and transfers; selling intermediate-city segments; automatic seat assignment; sleeper/mixed layouts; gender-based adjacency; children/infant fare rules; neighbor-free seats; paid luggage; coupons, wallets, loyalty, insurance, ratings/reviews, live GPS, multilingual/multicurrency support, dynamic pricing, operator self-service, marketplace settlement, native apps, and partial passenger cancellation.

These features add policies or integrations without strengthening the core demonstration. Sleeper layouts and segment inventory are candidates only after the release gates pass.

## Product policies

All policies below are proposed choices, not assertions about FlixBus or redBus.

1. **Direct journey:** a seat is allocated for the full trip. Boarding choices are pickup points in the origin city; dropping choices are in the destination city. They do not enable resale over subsegments.
2. **Identity:** public browsing; verified-email login before the hold begins. Preserve the chosen trip/seats through login, then revalidate availability. No password management or guest ownership transfer in v1.
3. **Party:** one to four adults. Require one name per seat and the account's verified contact email; phone is optional and normalized if supplied. Collect no government ID, date of birth, gender, or saved passenger profile.
4. **Sales:** book up to 30 calendar days ahead. Close sales 15 minutes before the trip's first scheduled departure. Show the customer's selected pickup time separately.
5. **Hold:** ten minutes from allocation, capped at sales close. Do not issue a hold with less than two minutes available. No automatic extensions; one active hold per customer per trip. Expired holds are retired before replacement.
6. **Price:** published fares remain fixed. Snapshot per-seat fares and total in integer paise; INR only. No service fee or add-on in v1. “Total” is the amount sent to checkout. A demo fare is not a statutory tax invoice.
7. **Payment:** one logical payment intent per booking, with distinct provider checkout attempts. A new attempt/order is allowed only after the preceding attempt is authoritatively failed with no unresolved payment. Start checkout only with at least 90 seconds remaining. Unknown outcomes do not authorize another attempt.
8. **Confirmation:** only verified captured payment plus a live, unexpired allocation can confirm. Browser redirects and signatures alone cannot confirm a booking.
9. **Deadline:** if finalization obtains the trip lock at or after hold expiry, it cannot confirm. Release inventory and refund any captured payment. The app explains that completing bank authentication after the reservation deadline may result in a refund.
10. **Cancellation:** a customer may cancel the whole confirmed booking at least two hours before the trip's first departure for a full fare refund. Later voluntary cancellation is unavailable. Cancelling an unpaid hold releases it without a refund. A trip cancelled by the administrator before departure causes full refunds for all captured fares regardless of customer cutoff.
11. **Refund:** cancellation is effective once committed; a refund can still be pending or require review. Released seats can be resold. A refund failure never resurrects the booking.
12. **Change:** no changes to published schedule/layout/fares. Correct a material error by cancelling that trip and publishing a replacement. Close/reopen sales changes only permission to create new holds; reopening cannot bypass the time cutoff.

## Customer flow and acceptance criteria

### C1 and C2: Find a suitable departure (`catalog` city suggestions; `booking` published-trip queries)

Given a valid route/date, search returns only published trips with matching origin/destination, dates, and party capacity. A departed trip is never sellable. Filter/date changes survive reload and browser back. Unknown city IDs and invalid dates produce field-level feedback; selecting the same city twice is rejected.

Show the full dates for overnight arrival, the departure timezone, total for the selected party where the fare is uniform, and a clearly labeled starting seat fare where fares vary. Search counts are advisory and may change; the hold transaction makes the final availability decision. Sold-out results have a clear disabled state, and an empty filter result offers “clear filters.”

### C3 and C4: Reserve a specific party (`booking`, `identity`)

Select seats locally, then submit one atomic hold request. If any seat is unavailable, reserve none and return the conflicting labels. The user can review available alternatives without re-entering names. Selection itself is not a reservation.

After a successful hold, display the server deadline, fare breakdown, selected stop times, cancellation rule, and seats. Reopening the page restores the same booking. Expiry clears the payment action and offers a fresh availability check. It preserves names only within the authorized page session; it never silently creates another hold.

### C5: Complete or recover payment (`booking`)

Hosted payment collection handles payment-method details and bank authentication. Closing its dialog means “not yet confirmed,” not “failed.” A timeout shows “We are checking your payment” and a status action. Disable repeated initiation while the same operation is pending, and enforce that behavior server-side.

Captured payment confirms once. If a callback is lost, a webhook or reconciliation confirms it. If confirmation is too late, show “Payment received; reservation expired; refund pending.” If a verified attempt failed while the hold is live, allow an explicit new checkout attempt/order under the same logical intent. Keep passenger/contact information and explain the next action without exposing raw provider errors.

### C6 and C7: Retrieve and cancel (`booking`, `notifications`)

The ticket includes a non-secret reference, operator, passenger names, seat labels, full local dates/times, chosen stops and addresses, total, and booking status. Access requires ownership. A print stylesheet is sufficient; PDF generation is deferred. An emailed notification links to the authenticated booking page.

Cancellation preview reports the eligibility time and refundable amount. Submission rechecks eligibility under the same trip lock used by confirmation. Repeated cancellation requests cannot create additional refunds. The detail page distinguishes cancelled booking, refund requested, refund processed, and refund needs review.

### C8: Administer and recover (`operations`)

Only a provisioned admin may publish/close/cancel inventory or inspect reconciliation cases. Publishing atomically creates all inventory rows and requires valid layout, fares, stop order, times, and cancellation policy. Repeated publication does not duplicate seats. Public users cannot assign themselves a role.

Trip cancellation commits the sellability change first. An idempotent worker drains outstanding bookings in bounded batches; captured payments observed later enter the same refund path. The admin sees progress and any unresolved exceptions, and every privileged command records actor, reason, request ID, and affected IDs.

## Quality targets

Targets must be measured under the workload defined in [Quality and operations](docs/quality-and-operations.md). They are not existing results.

- Zero duplicate live seat allocations, duplicate booking confirmations, or excess refunds across the concurrency/fault suites.
- At least 100 simultaneous attempts for one remaining seat: exactly one successful hold when requests fit the lock budget, or one winner plus explicitly retryable busy responses; every other completed attempt fails safely.
- Warm search p95 below 500 ms and uncontended booking mutations p95 below 750 ms, excluding provider time. Record p99, failures, hardware, DB compute, and connection settings as well.
- Core pages aim for LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1; report lab conditions and collect field metrics when enough real traffic exists.
- Target WCAG 2.2 AA: keyboard-complete booking, announced errors, visible focus, non-color seat state, and a tested accessible alternative to the graphical map. See the [W3C standard](https://www.w3.org/TR/WCAG22/).
- Under healthy dependencies, webhook processing and hold-expiry cleanup normally complete within 60 seconds; inventory correctness does not rely on that cleanup interval.
- Pilot availability objective 99.5% monthly, with a documented single-host limitation. Proposed restore targets: RPO ≤1 hour and RTO ≤4 hours, accepted only after a restore drill on the selected Neon plan.

## Portfolio release evidence

Publish a working sandbox deployment, a concise architecture walkthrough, ERD and decision records, generated API docs, CI results, concurrency/fault-test artifacts, accessibility findings, observed load-test results, and a deployment/restore runbook. Record a demo showing both a successful purchase and a late-payment refund. Never publish the supplied recording's personal or payment details.

Product telemetry may count search → seat view → hold → payment initiated → confirmed/cancelled/refunded. Use pseudonymous IDs; exclude passenger names, email, phone, card data, and bank screens. Funnel numbers must be labeled synthetic until real consented usage exists.

## Decisions still requiring implementation evidence

- Pin compatible stable framework/auth/ORM versions after the initial spikes; do not adopt a release-candidate dependency just because a documentation example uses it.
- Verify Razorpay account access, test-mode behavior, order recovery, refund idempotency, and capture configuration.
- Choose host region and Neon compute/backup plan after budget and latency measurements. No vendor tier or price is committed here.
- Validate email-login delivery and admin MFA configuration before the public demo. Provider onboarding is an implementation dependency, not an application feature.

## Visual acceptance update — 25 October 2026

FlixBus India is the selected visual reference following the user's implementation instruction. Target pixel-level fidelity for implemented surfaces using frozen reference states and matching viewport sizes; each page needs a browser comparison before being marked visually complete. Keep KwikBus branding, implemented feature scope, accessible interactions, and truthful fares/status. See [UI reference and evidence](docs/ui-reference.md). This changes the visual direction, not the inventory, authentication, or payment invariants.
