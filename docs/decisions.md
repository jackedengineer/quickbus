# KwikBus architecture decisions

All decisions are proposed as of 25 October 2026. Change the PRD, schema/protocol, and affected tests together if one is revised.

## ADR 001 — Modular monolith with durable worker

**Decision:** Express API and Node worker share backend modules and PostgreSQL. Start owns rendering/UI. Payments remain inside the booking orchestration boundary.

**Reason:** Inventory, booking status, compensation intent, and events can commit atomically. Multiple deployments per business domain would add consistency problems unrelated to the portfolio's main objective.

**Cost:** Modules need enforced imports and ownership; one database failure affects all business writes. A monorepo is a repository/build arrangement, not evidence of modularity by itself.

## ADR 002 — Full-trip inventory and explicit seat selection

**Decision:** Reserve one to four labeled seats for the entire trip. Only origin-city pickups and destination-city drops are selectable.

**Reason:** A simple unique allocation key gives a clear anti-oversell guard. Explicit selection avoids introducing an automatic assignment algorithm in v1.

**Cost:** KwikBus cannot resell a seat over non-overlapping intermediate segments. Supporting this later requires a new occupancy model and migration.

## ADR 003 — Serialize mutations per trip

**Decision:** Use PostgreSQL row locks on the trip plus unique current seat allocations, at READ COMMITTED, for every inventory/lifecycle mutation.

**Reason:** A coarse lock closes multi-seat, expiry, cancellation, and capture races with one protocol. No distributed lease is required for correctness.

**Cost:** One popular departure has limited write throughput. Keep transactions short and measure contention. A future finer-grained design must preserve the same invariants and lock-order discipline.

## ADR 004 — Strict immutable deadline and late-capture compensation

**Decision:** Hold and quote share one ten-minute deadline capped by sales close. Confirmation must observe live ownership before that deadline under the lock. Late capture causes compensation.

**Reason:** Inventory cannot remain reserved indefinitely while external authentication is unresolved. Provider event time cannot safely reclaim an already released seat.

**Cost:** A customer can complete bank authentication and still receive a refund. Explain the deadline, prevent new checkout starts near expiry, and test the recovery journey.

## ADR 005 — Durable operation intent, inbox, and outbox

**Decision:** Write payment/refund intent before calling the provider; persist signed webhook events before acknowledgment; commit notification/compensation events with domain transitions.

**Reason:** Retries and process crashes otherwise leave gaps between local state and external effects.

**Cost:** Workers, leases, reconciliation, retention, and admin exceptions become required scope. They replace invisible failure with explicit recoverable state; they do not create a distributed transaction with the provider.

## ADR 006 — Endpoint-specific provider guarantees

**Decision:** Razorpay test mode is the default. Keep a logical payment intent separate from provider checkout attempts. Follow the current create-order guide's fresh-order rule after verified failure, use its refund idempotency contract explicitly, and reconcile unknown order creation by the original receipt.

**Reason:** An application idempotency header cannot force an external API to deduplicate. A receipt is correlation evidence, not an assumed universal exactly-once guarantee.

**Cost:** Some ambiguous operations may need review while a hold expires. Favor safe compensation over issuing a second order automatically.

## ADR 007 — Verified-email checkout and minimal personal data

**Decision:** Browse anonymously; verify email before allocating a timed hold. Use an established auth library, manual admin provisioning, and MFA. Collect only names plus necessary contact information.

**Reason:** Ownership, recovery, and abuse controls are simpler than guest-booking claim/transfer flows. Starting the timer after verification avoids consuming it while waiting for login email.

**Cost:** This adds a login step compared with the recording's apparent guest checkout. Revisit only after core delivery and evidence are complete.

## ADR 008 — Normalized current state plus immutable history

**Decision:** Separate current allocations from booking items/events and payment/refund records. Snapshot published schedules, fares, stops, and policies.

**Reason:** Mutable catalog names or future policies must not rewrite an accepted booking. Historical cancelled bookings must not block resale.

**Cost:** Some duplication is intentional and migrations must preserve historical semantics. Do not replace relational claims/money with arbitrary JSON.

## ADR 009 — Small operational topology with explicit limits

**Decision:** Start with Caddy + web/API/worker containers and external Neon; no Kubernetes, broker cluster, or Redis inventory authority.

**Reason:** This demonstrates deployability, secrets, health, jobs, telemetry, and restore without an unnecessary infrastructure project.

**Cost:** A single host is a failure domain. State that limitation, verify the pilot objective, and move images to managed replicated containers if actual requirements justify it.

## ADR 010 — Cloudflare Workers deployment

**Accepted constraint:** the user requires the backend to run on Cloudflare. This supersedes ADR 009’s container/VM topology and ADR 001’s persistent Node process assumption. Express remains, using Cloudflare’s Node HTTP adapter. Start is Worker-compatible and uses an API service binding.

Use request-scoped Neon WebSocket pools and Drizzle interactive transactions. Node/pg direct connections remain for migration tooling. Background work uses scheduled/queue handlers with bounded batches and durable Postgres records, not polling loops or local files. The PostgreSQL trip lock and allocation constraints are unchanged.

**Verification gate:** real browser use of the Workers runtime, Neon transaction/rollback tests, independent-worker contention, and a deploy dry-run must pass before payment work. See [Cloudflare Express](https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/) and [Neon edge lifecycle](https://neon.com/docs/serverless/serverless-driver#pool-and-client-usage-notes).

## ADR 011 — FlixBus as the visual reference

**Status:** accepted from the user's implementation instruction, 25 October 2026.

Use the live FlixBus India UI as the reference for the small set of implemented KwikBus pages. Compare captured states at fixed widths and match typography, spacing, color, field geometry and interaction hierarchy. Keep KwikBus branding and honest development/feature copy; do not add commercial systems to populate an otherwise matching layout. Reference assets and intentional differences are documented in [ui-reference.md](ui-reference.md).

This supersedes the earlier generic visual direction in the UX spec. It does not change the seat-concurrency gate, introduce payments, or certify uncaptured pages as pixel-perfect.

## ADR 012 — Passwordless customer identity and staged V0 publication

**Status:** accepted from the user's implementation instructions, 25 October 2026.

Use Better Auth with Google sign-in and email OTP; do not expose passwords, password reset, magic links or unused OTP inspection endpoints. V0 remains an unpaid reservation preview. Google is published on the temporary Workers domain. The user chose to wait for `kwikbus.in` before public OTP email rather than use another verified sender. Public email controls therefore stay disabled until real delivery is configured and verified.

Use **KwikBus** in app and service/project branding. The canonical domain will be `kwikbus.in` after ownership and DNS setup. Preserve historical evidence and existing internal development identifiers rather than rewriting migrations/history. No admin surface is exposed; fresh admin MFA remains a gate for that later capability. See [authentication](authentication.md) and [V0 evidence](release-v0.md).

## ADR 013 — Use an owned subdomain and preserve access during DNS propagation

**Status:** accepted from the user's change of plan, 26 October 2026.

Use **kwikbus.jacked.dev**, rather than purchasing `kwikbus.in`. GoDaddy remains the registrar; the user approved moving authoritative DNS to Cloudflare after comparing the original export with all 21 application/email records in the pending zone. Existing web records remain DNS-only, and the new Worker hostname is the only new proxied endpoint. A separate Resend sending-only credential restricted to the already verified `jacked.dev` domain sends customer OTPs.

Switch backend APP_ORIGIN and frontend PUBLIC_ORIGIN together. Keep the existing preview canonical while local/user DNS still resolves the former Railway wildcard. New-host browser verification is a release gate; a successful TLS check using an explicit Cloudflare address is useful evidence but does not satisfy that gate. Do not broaden trusted origins or weaken TLS to work around propagation. [Cutover record](domain-cutover.md).

The cutover completed on 26 October 2026 after normal DNS and browser HTTPS succeeded. Both production origins now use the owned hostname. A cached staging redirect loop discovered in the real browser required a migration query and an origin-scoped `Clear-Site-Data: "cache"` recovery response. Cookies and application storage remain intact; clean-root navigation and reload then passed. See the cutover evidence for Google/mobile and OTP/desktop flows.

## ADR 014 — P0 operations before payment work; admin last

**Status:** implemented from the user's instruction, 26 October 2026.

Complete monitoring, bounded scheduled expiry, persistent inventory renewal, guarded releases and a measured isolated recovery drill before starting payments. Actual desktop/mobile browser use leads acceptance; SQL and two-instance contention checks prove transaction properties the browser cannot establish alone. All synthetic service/seat/fare data lives in PostgreSQL. An admin panel is the final slice after the customer lifecycle and portfolio release, with fresh MFA before privileged mutations.

Expiry runs through the same trip-lock/post-lock DB-time policy as customer commands. Renewal snapshots at most five departures from persistent definitions in one statement. The API stays private behind the web service binding. CI uses disposable PostgreSQL; real Neon evidence is recorded separately. Release requires clean pushed source, exact-revision green CI, serialized operators/migrations and native URL-query redaction in both Workers. Recovery never replaces production data during a drill. [Evidence and measured limits](p0-hardening.md).

## ADR 015 — Database catalog snapshots and conditional unpaid review

**Status:** accepted for the P1 customer journey, 27 October 2026.

Catalog input lives in normalized PostgreSQL cities/aliases, operators, directional routes, layouts/seats and city/service stops. Versioned owner seed/import tooling manages explicitly synthetic definitions; no admin UI or catalog mutation API is introduced. Runtime has read access to definitions and may insert published snapshots only. New service definitions use a new identity when changing a published geometry/timetable; existing trip labels, stops and quoted fares remain historical snapshots.

A bounded publication statement validates the complete layout and ordered endpoint stops, then inserts trip, seats and stops together. Service/departure uniqueness makes overlap safe. The additive migration retains old text/nullable references. Owner backfill fills missing menus under the same trip lock as booking commands, preserves existing snapshot IDs, and never invents a customer's chosen stops. The release repeats it after replacing the old API, before deploying the new web consumer.

Search resolves aliases and filters route, India service date, party size and live advisory capacity in PostgreSQL. Public cursors bind canonical filters, page size and departure/price plus UUID ordering. They are navigation state, not authorization; every field is validated and parameterized. Available-seat counts remain advisory. The hold transaction decides ownership.

Passenger review uses an owned conditional command with a required quoted integer `If-Match` version and UUID intent key. Its canonical payload includes the expected version. Trip lock, post-lock DB time, expiry cleanup, exact passenger-seat coverage, stop-role/order checks, verified account email, version increment, audit event and stored result share one transaction. Replaying a successful intent after expiry returns its original result without resurrecting ownership; the fresh review remains authoritative. The version is a command precondition, not a strong HTTP ETag for the time-varying representation.

Names/contact details remain in private database rows and page memory. They do not enter URLs, browser storage, event payloads or logs. Unpaid review does not extend a hold, capture payment or issue a ticket. The 90-second payment-start requirement is visible; enforcing it in the future payment command remains T17's prerequisite. Existing V0 reservations with missing choices are explicitly incomplete.
