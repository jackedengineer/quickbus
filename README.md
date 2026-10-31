# KwikBus

A small bus-booking portfolio application built around correct seat ownership, retry behavior, and failure recovery.

**Live v0.3.1 lifecycle preview:** [Open KwikBus](https://kwikbus.jacked.dev/). Passwordless Google/email OTP, database-backed search, seat reservation, Razorpay test checkout, printable owned tickets, confirmation email, whole-booking cancellation and full test-refund status are live. Operator trip cancellation uses a guarded CLI; admin stays deferred. TanStack Start and Express run on Cloudflare Workers with a private API binding and Neon/Drizzle transactions. No real travel tickets or live money. [Lifecycle delivery and measured limits](docs/lifecycle-delivery.md), [production browser evidence](docs/evidence/lifecycle-2026-10-29/production.json), [provider contract](docs/provider-contract.md).

Actual desktop/mobile acceptance covered provider failure and explicit retry, confirmation-email link restoration, two simultaneous cancellation requests, processed refund, wrong OTP, stale cancelled-trip links, rollback and isolated database restore. The 100-customer Neon correctness proof passed. The 31 October update measured public mobile search at 42/37/27 ms under 4× CPU/Fast 4G and adds isolated checkout documents with an app-owned return path. The 15-minute load exercise failed its latency/error/drop gates; Cloudflare traces confirmed free-tier CPU-limit terminations. The user chose to retain the free, limited-traffic preview and declined physical VoiceOver audio review. No full-scale, WCAG-conformance or live-money claim is made. [Acceptance results and reproduction](docs/acceptance-hardening.md).

**P0 operational baseline · v0.0.3-preview:** correlated/private logs and tested monitors, minute-by-minute expiry, hourly renewal from persisted service/seat definitions, isolated PostgreSQL/Workers CI, guarded releases and a measured restore/rollback drill are complete. Real browser flows lead acceptance; the 100-customer Neon proof supplements them. [Current evidence and limits](docs/p0-hardening.md), [browser performance](docs/p0-performance.md), [release runbook](docs/releasing.md). Admin stays at the end of the roadmap.

**P1 customer journey · v0.1.0-preview:** normalized database catalog/stops, real server search and pagination, equivalent seat map/list, stop restoration and versioned passenger/contact review are live. Production Google and mobile email OTP journeys passed save/reload/release; 19 integration checks and the updated 100-customer Neon proof supplement real browser acceptance. [Evidence, performance measurements and remaining limits](docs/p1-customer-journey.md). This is the historical unpaid baseline; the v0.2 sandbox adds payments. Admin is deferred.

## Run locally

Use Node 24.14.0 and pnpm 10.34.5. Copy `.env.example` to an ignored `.env` and configure a **dedicated development** Neon database. `DATABASE_URL` uses a pooled DML-only application role; `MIGRATION_DATABASE_URL` uses the direct owner/migration connection. Set a random secret of at least 32 bytes. Keep credentials out of Git and chat.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm db:migrate
pnpm db:seed
docker run -d --name quickbus-mailpit -p 127.0.0.1:8025:8025 axllent/mailpit:v1.27.8
pnpm dev
```

If the local inbox container already exists, use `docker start quickbus-mailpit` instead of creating it again. Open [KwikBus](http://localhost:3000); the local inbox is at [Mailpit](http://localhost:8025). Seed creates five cities and three explicitly synthetic operators, with four directional routes and stop menus persisted in PostgreSQL. It adds future journeys idempotently without deleting reservations. With `PAYMENTS_ENABLED=true` and dedicated test-mode credentials, local development drives minute-by-minute expiry/payment recovery while running. It does not run hourly inventory renewal; rerun seed when its timetable ages out. Production renewal runs hourly. Keep payments disabled when provider credentials are absent.

`pnpm dev` writes only runtime variables to ignored `apps/api/.dev.vars`, starts Express in Wrangler on port 8787, and starts the web Worker on port 3000. The migration owner URL is never copied to the Worker. Ctrl+C stops both processes.

`pnpm check` first builds the web target to generate its ignored route types, then runs lint and strict TypeScript. It therefore works on a fresh checkout before a dev server has generated routes.

For the second API instance and correctness checks:

```sh
pnpm dev:peer
# In another terminal while both APIs and the web app are running:
node --env-file=.env node_modules/vitest/vitest.mjs run tests/integration --no-file-parallelism
pnpm test:contention
pnpm check
pnpm build
```

The contention harness creates only synthetic fixtures, waits for concurrent requests to settle, audits the database independently, and cleans up its own rows. It uses the direct owner connection for fixture setup and a trip-scoped fault trigger; HTTP requests still pass through normal authentication and the restricted runtime role. It refuses to run without explicit local fixture flags. Run it against a disposable development database, never production. While it runs, synthetic trips may briefly appear in the development timetable.

## Implementation evidence

- [Tickets, notification outbox, cancellation, trip drain and v0.3 release](docs/lifecycle-delivery.md)
- [Production browser/security/performance record](docs/evidence/lifecycle-2026-10-29/production.json)

- [Razorpay test checkout, late-capture refunds and production browser evidence](docs/payment-delivery.md)
- [Observed provider contracts and safe retry limits](docs/provider-contract.md)
- [Financial-schema recovery drill](docs/recovery.md)

- [P1 catalog, server search, stops and passenger review](docs/p1-customer-journey.md)

- [P0 monitoring, scheduled jobs, CI and recovery evidence](docs/p0-hardening.md)

- [V0 preview, browser evidence and deployment runbook](docs/release-v0.md)
- [Passwordless Google and email OTP](docs/authentication.md)
- [Phase 0 Cloudflare/Neon compatibility and remaining release gates](docs/compatibility.md)
- [Reservation correctness evidence and reproducible commands](docs/reservation-proof.md)
- [FlixBus visual reference, browser verification, and asset provenance](docs/ui-reference.md)
- [Task status](tasks/todo.md)

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

## Architecture decisions

- One modular backend on Workers; separate Start web Worker connected by a service binding. Node is local tooling and compatibility APIs, not a persistent production server.
- PostgreSQL is the inventory authority. Every trip mutation takes its trip-row lock; allocation uniqueness is enforced in the database. Expiry uses database time read after the lock.
- The hold and its idempotency response commit together. A party receives every requested seat or no seats. There is no external provider call inside that transaction.
- Email must be verified before a hold. Checkout freezes versioned details and persists an intent/attempt before provider I/O. Signed events and authoritative provider reads share a trip-locked finalizer; late captures refund without reviving seats. Unknown order creation never retries its POST. Durable leased jobs recover missed callbacks; immutable refund keys preserve replay identity.

## Next customer slices

Print tickets and deduplicated confirmation delivery come next, followed by whole-booking paid cancellation and its refund policy. Compensation refunds already work; paid cancellation is not exposed. Trip cancellation and full lifecycle accessibility/load acceptance follow. Admin stays last. Live Razorpay keys are rejected; this portfolio release handles test money only.

## Application identity

The application is **KwikBus**. The production domain is `kwikbus.jacked.dev`; OTP sends from `signin@jacked.dev` through a dedicated restricted Resend key. Cloudflare services use `kwikbus` (web) and `kwikbus-api` (private backend). Existing database identifiers and historical evidence retain their original names until a safe migration is needed.
