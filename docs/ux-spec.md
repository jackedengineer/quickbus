# KwikBus UX specification

## Design approach

The user's implementation update selects FlixBus India as the visual reference, with pixel-level layout fidelity as the target for each implemented surface. Use captured states and fixed viewport comparisons for typography, color, spacing, field geometry, result cards, and drawers. Retain KwikBus branding and truthful feature copy. The current study, exact measured geometry, temporary reference-photograph provenance, and remaining differences are recorded in [ui-reference.md](ui-reference.md). Commercial services outside v1 must not become active controls merely to match a screenshot. The critical journey should work at 320 px, tablet widths, desktop, 200% zoom, and keyboard-only input; record which checks were actually performed.

## Pages and behavior

| Route | Layout and primary action | Required states |
|---|---|---|
| `/` | Search-first home; origin/destination/date/party; swap; a few seeded route shortcuts | Invalid/same city, no suggestion, keyboard suggestion selection, past date |
| `/search` | Editable search summary; desktop filter rail and result list; mobile filter sheet; previous/next day | Loading skeleton, request error/retry, no trips, empty filter, sold out, stale counts |
| `/trips/$tripId` | Trip details with stop addresses, full schedule, policy; seat map and selected-seat summary | Available/selected/unavailable seats, map load failure, party limit, conflict |
| `/login` | Email verification; safe return URL preserving trip/seats | Sent, resend throttled, invalid/expired link, verified; no hold yet |
| `/checkout/$bookingId` | Passenger names, pickup/drop review, optional phone, policy acknowledgement; sticky total/deadline | HELD, stale version, expiring, expired, payment preparation, provider unknown |
| `/bookings/$bookingId` | Canonical status and actions; ticket when confirmed; payment/refund timeline | Pending, failed attempt, confirmed, expired, cancelled/refund pending, needs review |
| `/bookings` | Own reservations/tickets, newest first | Loading/error, no bookings, pagination |
| `/admin` | Restricted operational view and draft trip flow | Draft validation, publish conflict, sales closure, cancel progress, unresolved cases |

### Search and comparison

Autocomplete must select a city ID, accept known aliases, and support keyboard navigation. Do not submit free text as an unvalidated city identifier. A date is interpreted in the trip market timezone. Include arrival date for overnight journeys and the selected pickup's exact address/time before the customer reserves.

Cards prioritize departure/arrival, operator, duration, bus type, starting fare, and availability. Omit ratings and discount badges because v1 does not implement those systems. Give result filters descriptive labels and a clear reset; keep filter state in the URL. Use stable skeleton dimensions to avoid layout shifts.

### Seat map and reservation

Local selection toggles labeled buttons/checkboxes. Each accessible name includes seat label, row/window context, fare, and availability. Use icon/text distinctions as well as color. Provide a list view with equivalent selection behavior for customers who cannot use the graphic.

Desktop can show the map beside the trip summary; mobile uses a full-width panel with a visible close/back action and a bottom selection summary. Keep scroll regions simple. Dialogs trap focus, support Escape, restore focus to the opener, and expose an accessible title.

The reserve button says “Reserve these seats.” After authentication, recheck the original selection. A conflict message identifies unavailable labels, keeps unaffected local selections, and asks the user to choose again. Never silently substitute seats or create a partial party reservation.

### Checkout and time pressure

Show “Seats and total reserved until [local time]” with a countdown. Announce meaningful thresholds, such as two minutes and expiry, rather than speaking every tick. Authentication happens before the hold starts. No automatic extensions or hidden grace periods.

At less than 90 seconds remaining, stop new/reopened provider checkout and explain the reservation must be renewed. If provider UI is already open, its eventual result still follows the strict finalization rule. Explain this before payment starts. A ten-minute cutoff is a real inventory constraint; evaluate WCAG timing guidance and alternatives during accessibility review rather than declaring a timing exception without review.

On reload, fetch the current booking and remaining time. A backgrounded tab does not reset the timer. Preserve non-sensitive navigation intent and the durable booking ID, not a second local copy of the authoritative booking. Do not persist passenger/contact data in local storage.

### Payment and recovery copy

| State | Suggested message | Action |
|---|---|---|
| Order preparing | “Preparing secure checkout…” | Disable duplicate initiation; allow status refresh |
| Provider UI closed | “Payment is not confirmed yet.” | Check status; reopen only if server says safe |
| Outcome unknown | “We are checking your payment. Your booking status will update here.” | Status view; no new order |
| Known failure, hold live | “That payment did not complete. Your seats remain reserved until …” | Explicit new checkout attempt after server safety checks |
| Hold expired, no known capture | “Your reservation expired. Check availability to reserve again.” | Explicit fresh search/hold |
| Late capture | “Payment received after the reservation expired. A refund is pending.” | Refund status |
| Confirmed | “Booking confirmed.” | View/print ticket |
| Cancelled, refund pending | “Booking cancelled. Your refund is being processed.” | Refund status |
| Review required | “This payment needs review. Your reference is …” | Show safe reference and actual support route |

Do not tell the user “you were not charged” merely because a request timed out. Do not expose raw gateway codes as the only explanation. Provider-owned bank authentication cannot be redesigned by KwikBus, but the surrounding recovery experience can be clear and durable.

Reopening an already issued checkout is permitted only after a provider fetch establishes that it is unused and resumable. If that cannot be proved, show pending/review rather than relaunching. An actual failed payment uses a new checkout attempt/order after the failure checks; an HTTP retry of the preparation command reuses its original local attempt.

### Ticket and cancellation

A ticket is generated from the confirmed booking snapshot, with an accessible print layout. It is never a bearer authorization credential. The printable page contains the same ownership-protected information as the detail page; avoid personal data in URLs.

The cancellation dialog shows the whole booking, full refundable amount, cutoff, and the distinction between cancelling seats now and receiving money later. Submission rechecks the rule. If eligibility changes while the dialog is open, return a clear explanation rather than accepting a stale preview. On cancellation success, remove the travel ticket action and show the cancellation/refund status.

## Accessibility and usability verification

- Verify the full journey using keyboard and a screen reader; automated scans are complementary.
- Maintain visible focus, logical heading order, field labels, error summary links, adequate contrast, touch targets, and reduced-motion support.
- Provide explicit loading/progress status and announce terminal outcomes without moving focus unexpectedly.
- Test double-click, refresh, browser back, reconnect, duplicate tabs, expired login links, long passenger names, midnight departure, and an overnight arrival.
- Ask a small set of users to find a trip, reserve two seats, recover a failed payment, and cancel. Observe completion and confusion; do not invent conversion or usability scores.
- Use only synthetic demo users/payments in screenshots and recordings. The supplied source recording includes sensitive material and is not suitable as public portfolio evidence.

The acceptance target is [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/). Record tested criteria and unresolved findings before making a conformance claim.
