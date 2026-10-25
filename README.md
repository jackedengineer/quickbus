# QuickBus planning pack

Build a small bus-booking application whose strongest feature is that reservations, payments, cancellations, and recovery behave correctly under contention and failure.

**Status:** proposed specification, prepared 25 October 2026. The workspace was empty when reviewed. Application code, migrations, load tests, and deployments do not exist yet. The documents define the implementation and its release gates; they do not certify a running system as production-ready.

The requested stack is retained: **TanStack Start, Node.js/Express, TypeScript, pnpm/Turborepo, Neon PostgreSQL, and Drizzle ORM**. Defaults accepted in this conversation: India/INR, one developer working part-time, curated inventory, and Razorpay test mode. Feature and policy details below are recommendations for review.

## Read in this order

1. [Recording and competitor review](docs/research/recording-review.md): timestamped observations, UX critique, and evidence limits.
2. [Product requirements](PRD.md): scope, policies, customer journeys, and measurable acceptance criteria.
3. [Capability map](CAPABILITY-MAP.md): module ownership and dependency direction.
4. [Architecture](docs/architecture.md): boundaries, repository structure, deployment, and tradeoffs.
5. [Database design](docs/database-design.md): entities, keys, constraints, indexes, and snapshots.
6. [Booking correctness](docs/booking-correctness.md): locking, expiry, idempotency, payment ambiguity, refunds, and crash recovery.
7. [API contract](docs/api-contract.md): endpoints, payloads, authorization, and retry semantics.
8. [UX specification](docs/ux-spec.md): page behavior, responsive layouts, accessibility, and failure states.
9. [Quality and operations](docs/quality-and-operations.md): tests, service objectives, security, deployment gates, and runbooks.
10. [Implementation plan](tasks/plan.md) and [task backlog](tasks/todo.md): ordered vertical slices and verification checkpoints.
11. [Decision records](docs/decisions.md) and [primary sources](docs/sources.md).

## The central decisions

- One modular backend and one database, with an API process and a durable worker. Keep the reservation/payment workflow within one transactional boundary.
- PostgreSQL owns seat allocation. A unique key prevents two live claims for a seat; short transactions serialize mutations for the same trip.
- A ten-minute hold has one immutable server deadline. Payment outcomes arriving after release cause a refund, never displacement of another booking.
- Provider calls happen outside database transactions. Durable intents, webhook inbox records, an outbox, and reconciliation bridge the failure windows.
- Browse publicly; verify email before creating a hold. Build one direct-trip seater layout, explicit seat choice, payment, ticket retrieval, full cancellation/refund, and essential administration.
- Demonstrate correctness with reproducible evidence: contended last-seat tests, duplicate webhooks, delayed captures, worker crashes, and a restore exercise.

Start with the booking-concurrency proof and the framework/provider compatibility spikes. A visually complete clone is a poor foundation if its inventory and money flows are unreliable.

## Review decisions before implementation

The highest-impact choices are full-trip inventory, verified-email checkout, explicit seat selection, a strict hold deadline, and the proposed cancellation policy. Read the PRD and decision records together before changing them: each affects the database and recovery protocols.

No commands in these documents are existing project scripts. Commands in the plan describe the interface to add during scaffolding.
