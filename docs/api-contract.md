# KwikBus API contract

## Deployed unpaid surface

The sections after this implementation note define the target contract, including future DTO/OpenAPI packages, problem details, payments and admin. They are not a claim that those endpoints exist. The current Express/Zod boundary lives in `packages/backend/src/app.ts`; [task status](../tasks/todo.md).

| Current route | Behavior |
|---|---|
| `GET /api/health/live`, `/ready`, `/maintenance` | Liveness, real database readiness and freshness/horizon/backlog health; maintenance returns 503 when degraded. |
| `GET /api/v1/session` | Safe auth availability flags and the current verified customer; session cookie renewal propagates through SSR. |
| `GET /api/v1/trips`, `/trips/:id/seats` | Bounded database-backed preview timetable and authoritative seat availability. Filtered/cursor-based server search remains P1. |
| `POST /api/v1/holds` | Verified customer; UUID idempotency key, one to four distinct labels, expected INR total. Atomic all-or-none hold and replay result. |
| `GET /api/v1/bookings`, `/bookings/:id` | Owned unpaid reservations only; no other customer's booking data. |
| `POST /api/v1/bookings/:id/release` | Owner, UUID command key and current trip-lock protocol; no physical deletion of history. |
| Better Auth allowlist under `/api/auth/*` | Google social sign-in/callback, send/verify sign-in email OTP, sign-out and error return only. Passwords, magic links, OTP inspection/reset and admin methods are unreachable. |

Browser calls stay on the public web origin and pass through a private API service binding. Mutations require the exact canonical Origin and bounded bodies. Current errors are bounded JSON `code`/`detail` responses; UUID request correlation and safe Server-Timing are response headers. No payment, webhook, ticket or admin route is exposed.

## Common contract

Express owns `/api/v1/*`. Better Auth owns `/api/auth/*`; provider webhooks use `/webhooks/razorpay`. Every endpoint has runtime input/output schemas in `packages/contracts`, an OpenAPI representation, and contract tests. Share DTOs and generated client functions, never Drizzle entities or private session types.

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
