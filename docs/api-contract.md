# KwikBus API contract

## Deployed customer sandbox surface

The implementation note below describes shipped behavior. Later sections retain
the broader target contract; generated OpenAPI and admin are not implied to exist.
Express/Zod inputs live in `packages/backend/src/app.ts`, payment/cancellation route
modules and `packages/contracts`. [Task status](../tasks/todo.md),
[current acceptance](acceptance-hardening.md).

| Current route | Behavior |
|---|---|
| `GET /api/health/live`, `/ready`, `/maintenance` | Liveness, PostgreSQL readiness and inventory/job/notification health; degraded maintenance is 503. |
| `GET /api/v1/session` | Safe auth availability/current verified customer, with cookie renewal propagated through SSR. |
| `GET /api/v1/catalog`, `/cities`, `/trips`, `/trips/:id`, `/trips/:id/seats` | Persisted catalogue and stops, bounded filtered/cursor search, trip snapshots and authoritative availability. |
| `POST /api/v1/holds` | Verified customer, UUID idempotency key, one to four seats, expected INR quote and selected stops; atomic hold/replay. |
| `GET /api/v1/bookings`, `/bookings/:id` | Owned lifecycle history/review, immutable confirmed ticket snapshot, cancellation/refund/notification status. Never another owner's data. |
| `PATCH /api/v1/bookings/:id/details` | Owner, command key and `If-Match`; validated passenger/contact/stops update and replay before payment locks details. |
| `POST /api/v1/bookings/:id/release` | Owner/key and trip lock; terminal history retained. |
| `POST /api/v1/bookings/:id/checkout` | Owner/key/`If-Match`, explicit test-policy consent; frozen money intent and durable order/reconciliation jobs. |
| `GET /api/v1/bookings/:id/payment` | Owned test-mode financial view; server `remainingSeconds`, `canStart`, refund states and checkout `checking`/`canOpen`. Provider fields only when opening is eligible. A due check wakes bounded leased recovery. |
| `POST /api/v1/bookings/:id/payment/verify`, `/payment/refresh` | Owned reconciliation hints; verify additionally checks the stored order/payment HMAC. Neither confirms seats from browser data. |
| `GET /api/v1/bookings/:id/cancellation`, `POST /bookings/:id/cancel` | Locked policy preview and idempotent/versioned full-booking cancellation with one refund intent. |
| `POST /api/webhooks/razorpay` | Exact-byte signature verification before durable signed-event intake; exempt from browser Origin, not provider authentication. |
| Better Auth allowlist under `/api/auth/*` | Google, sign-in email OTP, sign-out and error return only. No passwords, magic links, OTP inspection/reset or admin methods. |

All browser API calls use the canonical web origin/private service binding. Cookie
mutations require exact Origin and bounded bodies. Authenticated `/checkout` is a
disposable UI document, not a money command. Narrow same-origin framing, nonce CSP,
private/no-store responses and ownership remain enforced. Current errors are
bounded JSON `code`/`detail`; safe request correlation/Server-Timing are headers.
No admin API or live-money mode is exposed.

## Common contract

Express owns `/api/v1/*`. Better Auth owns `/api/auth/*`; provider webhooks use `/api/webhooks/razorpay`. Every endpoint has runtime input/output schemas in `packages/contracts`, an OpenAPI representation, and contract tests. Share DTOs and generated client functions, never Drizzle entities or private session types.

Use opaque string IDs, ISO 8601 UTC timestamps, explicit timezone/local dates, and integer minor-unit amounts. Public fields use camelCase; business state values use uppercase. Validate query limits, array uniqueness, field lengths, malformed dates, unknown IDs, and body sizes. Never accept `userId`, `role`, a refund amount, a provider status, or a calculated final fare as client authority.

Private endpoints require a verified session and ownership. Return `404` for a missing or other customer's booking. Admin endpoints additionally require the provisioned admin role and fresh MFA. Every mutation rechecks authorization at the server boundary, even if the page has a route guard.

`Idempotency-Key` is required for domain POST/PATCH commands. Auth-library endpoints retain their documented semantics and are not wrapped with booking command replay. GET is safe to retry. DELETE is not needed for booking lifecycle; explicit cancellation resources make the resulting state reviewable.

### Errors

Use `application/problem+json` with one stable schema:

```json
{
  "type": "urn:quickbus:problem:seat-unavailable",
  "title": "Some seats are no longer available",
  "status": 409,
  "code": "SEAT_UNAVAILABLE",
  "detail": "Choose another seat to continue.",
  "requestId": "opaque-request-id",
  "fieldErrors": [],
  "conflictingSeats": ["4A"],
  "retryable": false
}
```

Optional structured fields are schema-defined for each code; no stack traces or raw provider messages.

| Status | Codes and meaning | Client action |
|---|---|---|
| 400 | `MALFORMED_REQUEST` | Correct syntax |
| 401 | `AUTH_REQUIRED` | Verify/login, preserve non-sensitive navigation intent |
| 403 | `ADMIN_REQUIRED`, `CSRF_REJECTED` | Do not auto-retry |
| 404 | `NOT_FOUND` | Stop; never disclose other owners |
| 409 | `SEAT_UNAVAILABLE`, `QUOTE_CHANGED`, `HOLD_ALREADY_EXISTS`, `TRIP_UNAVAILABLE` | Refresh state; new user intent gets a new key |
| 409 | `HOLD_EXPIRED`, `PAYMENT_STATE_UNKNOWN`, `CANCELLATION_NOT_ALLOWED` | Display resource state/recovery action |
| 409 | `IDEMPOTENCY_IN_PROGRESS`, `RESOURCE_BUSY` | Bounded retry with same key and `Retry-After` |
| 409 | `IDEMPOTENCY_RESULT_EXPIRED` | Follow authorized resource link; never repeat automatically |
| 412 | `STALE_BOOKING`, `STALE_DRAFT` | Fetch current version and review |
| 422 | `VALIDATION_ERROR`, `IDEMPOTENCY_KEY_REUSED` | Correct intent/body; key misuse must not replay old result |
| 429 | `RATE_LIMITED` | Respect `Retry-After`; no new-key bypass |
| 503 | `DEPENDENCY_UNAVAILABLE` | Retry safe reads or the same keyed command; status may be unknown |

No automatic mutation retry without a stable intent key. Replayed results may contain a historical snapshot; refetch the linked resource for its current status and fresh server time. Send a fresh HTTP `Date` and `Idempotency-Replayed: true` header without changing the stored business result.

## Endpoint inventory

| Endpoint | Access | Request and response |
|---|---|---|
| `GET /cities?q=&limit=` | Public, bounded/rate-limited | Query/alias → IDs, display names, timezone; max 20 |
| `GET /trips?originId=&destinationId=&date=&passengers=&sort=&cursor=` | Public | Valid route/date/filters → trip summaries, advisory availability, next cursor |
| `GET /trips/:id` | Public | Published trip → operator, schedule, stop choices, amenities, policy summary |
| `GET /trips/:id/seats` | Public | Seat layout and effective availability; `serverTime`; never holder identities |
| `POST /holds` | Verified customer | Trip, seats, stops, expected quote → `201` booking, deadline, total, Location |
| `GET /bookings?cursor=&limit=` | Verified customer | Own bookings, newest first; max 50 |
| `GET /bookings/:id` | Owner | Canonical booking, item snapshots, payment/refund summaries, version, allowed actions |
| `PATCH /bookings/:id/details` | Owner, HELD only | Names keyed by seat, optional phone, stop selection, `If-Match` → updated version |
| `POST /bookings/:id/payment-intents` | Owner | Policy version/acceptance, expected booking version → `202` existing/new durable intent, status Location |
| `GET /bookings/:id/payment-intent` | Owner | Creation/review state; hosted checkout config only if eligible; never provider secrets |
| `POST /bookings/:id/checkout-attempts` | Owner | Explicit new attempt after verified prior failure; fresh key → `202` attempt/status Location; forbidden while outcome unresolved |
| `POST /bookings/:id/payment-observations` | Owner | Provider callback IDs/signature → `202` authoritative verification scheduled; cannot directly set status |
| `GET /bookings/:id/cancellation-preview` | Owner | Current eligibility, full refundable amount, cutoff; advisory only |
| `POST /bookings/:id/cancellations` | Owner | Reason enum → `200/202` cancelled state and refund reference if any |
| `GET /bookings/:id/refund` | Owner | Refund state, amount, timestamps, safe next action |
| `GET /admin/catalog` | Admin | Seeded operators/routes/layouts/stops for authoring |
| `POST /admin/draft-trips` | Admin | Schedule/template/stop/fare input → draft |
| `PATCH /admin/draft-trips/:id` | Admin | Validated edits plus `If-Match` → draft version |
| `POST /admin/trips` | Admin | Draft ID/version → atomically published trip |
| `PATCH /admin/trips/:id/sales` | Admin | `OPEN/CLOSED`, version, reason → updated sale permission |
| `POST /admin/trips/:id/cancellations` | Admin | Reason → `202` cancelled trip and drain progress Location |
| `GET /admin/bookings/:id/timeline` | Admin | Redacted booking/payment/job/audit timeline |
| `GET /admin/reconciliation-cases?cursor=&state=` | Admin | Paginated exceptions with owner/next action |
| `POST /admin/reconciliation-cases/:id/rechecks` | Admin | Reason → `202` safe provider fetch; no arbitrary charge/refund |
| `POST /admin/jobs/:id/replays` | Admin | Reason → replay only allowlisted idempotent handler with its existing effect key |
| `POST /webhooks/razorpay` | Signature-authenticated | Exact raw bytes → durable inbox ACK; not session-authenticated |
| `GET /health/live`, `GET /health/ready` | Infrastructure | Minimal liveness; readiness checks DB reachability within a short deadline |

All `/api/v1` paths above omit the common prefix in the table. Readiness does not call the payment provider on every probe. Detailed diagnostics and metrics remain private.

### Search DTO

Use a fixed enum for sort (`DEPARTURE_ASC`, `PRICE_ASC`, `DURATION_ASC`), optional AC flag and time window, and one validated cursor with a deterministic ID tiebreaker. Bind cursors to the filter/sort shape; invalid combinations are rejected. Availability can change between pages; do not promise a transactionally frozen multi-page inventory view.

```ts
type TripSummary = {
  id: string;
  operatorName: string;
  departureAt: string;
  arrivalAt: string;
  timezone: 'Asia/Kolkata';
  durationMinutes: number;
  startingFare: { amountMinor: number; currency: 'INR' };
  availableSeats: number;
  isBookable: boolean;
};
```

### Hold DTO

```json
{
  "tripId": "trip-uuid",
  "seatLabels": ["4A", "4B"],
  "boardingStopId": "pickup-uuid",
  "droppingStopId": "drop-uuid",
  "expectedTotalMinor": 150000,
  "currency": "INR"
}
```

The success response includes `id`, `reference`, `status: HELD`, `version`, `expiresAt`, `serverTime`, selected seats/stops, authoritative item prices/total, and allowed actions. The expected amount detects a stale quote; it is not used to calculate the charge. Ownership comes from the session.

### Booking detail and conditional actions

Return lifecycle and financial states separately. Example: `status: CANCELLED`, `paymentStatus: CAPTURED`, `refundStatus: PENDING` is valid. `allowedActions` improves UX but the server recalculates permission on every command. Return an ETag derived from the booking version; mutable details require `If-Match`.

Preparing payment freezes detail edits. If a user needs a name/stop correction afterward, cancel the unpaid booking and explicitly create a new hold; do not mutate an order's underlying agreement. Preserve the new form draft without promising that the old seats can be reacquired.

Cancellation retry keys are necessary, but the business rule additionally guarantees one cancellation transition and one refund per captured attempt even if the caller sends different keys. Recheck endpoints fetch truth; they do not directly edit money status.

## Security and retry contract

Session cookies are Secure, HttpOnly, appropriately SameSite, and host-scoped. Domain commands require origin/CSRF protection; signed webhooks use their own route and validation. Set strict body limits and ingress/API quotas. Scope webhook identities and provider credentials to test versus live environments.

Shared DTO validation is a developer convenience, not trust in the browser. The API validates every incoming request. Provider responses are independently parsed and validated before they become observations.

The frontend may poll payment/booking status every 2 seconds initially, then back off to 5–10 seconds with jitter. Stop fast polling when hidden, terminal, or rate-limited; refetch on focus. At a deadline, refresh authoritative state. A status GET never issues a provider charge, creates a new hold, or extends the reservation.

Keep the browser-to-app command key, logical payment-intent ID, checkout-attempt ID, worker job identity, provider receipt, payment ID, refund key, and webhook event ID distinct. Each deduplicates a different boundary.

## Implemented test-payment surface (27 October 2026)

These routes describe the landed sandbox slice. Planned cancellation/ticket/admin
routes elsewhere in this document are not available yet.

| Method / route | Request and authority | Result |
|---|---|---|
| GET `/api/v1/bookings/:id/payment` | Verified session, owned booking UUID. | Database status, test admission flag, latest attempt, refund states and review flag. Checkout public key/order/quote appear only while eligible to open. Other owners receive 404. |
| POST `/api/v1/bookings/:id/checkout` | Exact same Origin, verified session, UUID Idempotency-Key, quoted integer If-Match, strict `{policyAccepted:true}`. No client amount/order fields. | 202 with local checkout UUID after durable intent/jobs; no provider success claim. Stale version 412, missing version 428, incomplete details 422, account budget 429, ended/deadline/unresolved retry 409. |
| POST `/api/v1/bookings/:id/payment/verify` | Same owned-session/Origin guards; strict checkoutId, paymentId and 64-hex signature. HMAC uses the stored order ID. | 202 read-reconciliation hint. Invalid signature 401. It never confirms inventory directly. |
| POST `/api/v1/bookings/:id/payment/refresh` | Same guards; strict local checkoutId only. | Coalesced 202 recovery hint; no arbitrary provider-ID lookup. |
| POST `/api/webhooks/razorpay` | Exact raw JSON bytes, provider signature and bounded event-ID headers. No customer cookie or browser Origin requirement. | 200 only after inbox/job commit. Invalid signature 401, malformed/unsupported event 400, changed bytes for one event ID 409, unavailable persistence/configuration 5xx. |

The webhook alone accepts up to 256 KiB, rejects compressed input and verifies the
signature before parsing. Other API payloads retain the 16 KiB bound. No card/bank
fields are accepted by KwikBus. The SDK is lazy-loaded from the official provider;
client callback data is a hint, not an authoritative payment observation.

Booking states now include PAYMENT_PENDING and CONFIRMED. Availability retains
CONFIRMED allocations beyond the original hold deadline. The unpaid release
command accepts PAYMENT_PENDING but rejects CONFIRMED with
PAID_CANCELLATION_REQUIRED. There is no paid cancellation API in this release.

All responses remain no-store and the backend remains private behind the web
service binding. Existing wrong-origin and legacy-host mutation rejection remain
in force. See [delivery evidence](payment-delivery.md) and
[provider recovery rules](provider-contract.md).

## Implemented lifecycle surface (29 October 2026)

The previous section is the historical v0.2 payment surface. The current lifecycle
implementation adds the following; deployment identity and browser results live
in [the delivery record](lifecycle-delivery.md).

| Method / route | Request and authority | Result |
|---|---|---|
| GET `/api/v1/bookings/:id` | Verified owner session. | One statement snapshot with immutable ticket details, server-derived wasConfirmed, confirmationEmail delivery state, tripCancelled and accepted cancellation source/time/amount. A full reference is never authorization. |
| GET `/api/v1/bookings/:id/cancellation` | Verified owner session. | Current version, policyVersion1, server time, two-hour cutoff, eligibility and full refundable test fare. A preview creates no reservation/refund effect. |
| POST `/api/v1/bookings/:id/cancel` | Same Origin, verified owner, UUID Idempotency-Key, quoted integer If-Match, strict `{policyVersion:1}`. |200 `{id,status:"CANCELLED"}` after atomic commit; refund completion is read separately. Wrong owner404, stale version412, missing precondition428, changed key payload422, closed policy/trip/state409. Repeated cancellation with different keys still creates one business transition. |

Payment status now includes tripCancelled and withholds checkout opening/starting
when sales are cancelled. Public trip/detail/seat reads stop offering cancelled
or closed journeys; a stale browser selection still faces the transactional guard.
Confirmed visible reviews check status every15seconds; unresolved checkout/refund
polling uses4seconds, stops when hidden and refreshes on focus. Status fetches have
a10second browser timeout. Printing uses the owned page's print stylesheet; no
public bearer-ticket endpoint, PDF service or privileged cancellation route exists.

The trusted trip command is documented in [operations](operations.md). It requires
an explicit reviewed audience limit and database confirmation. Its progress read
reports remaining bookings separately from outstanding refunds. No admin UI/API
is exposed by this release.
