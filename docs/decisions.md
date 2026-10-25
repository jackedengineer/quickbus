# QuickBus architecture decisions

All decisions are proposed as of 25 October 2026. Change the PRD, schema/protocol, and affected tests together if one is revised.

## ADR 001 — Modular monolith with durable worker

**Decision:** Express API and Node worker share backend modules and PostgreSQL. Start owns rendering/UI. Payments remain inside the booking orchestration boundary.

**Reason:** Inventory, booking status, compensation intent, and events can commit atomically. Multiple deployments per business domain would add consistency problems unrelated to the portfolio's main objective.

**Cost:** Modules need enforced imports and ownership; one database failure affects all business writes. A monorepo is a repository/build arrangement, not evidence of modularity by itself.

## ADR 002 — Full-trip inventory and explicit seat selection

**Decision:** Reserve one to four labeled seats for the entire trip. Only origin-city pickups and destination-city drops are selectable.

**Reason:** A simple unique allocation key gives a clear anti-oversell guard. Explicit selection avoids introducing an automatic assignment algorithm in v1.

**Cost:** QuickBus cannot resell a seat over non-overlapping intermediate segments. Supporting this later requires a new occupancy model and migration.

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
