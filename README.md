# KwikBus

A small bus-booking portfolio application built around correct seat ownership, retry behavior, and failure recovery.

**Live V0 preview:** [Open KwikBus](https://kwikbus.jacked.dev/). TanStack Start and Express run on Cloudflare Workers with a private API service binding and Neon/Drizzle transactions. Google and email OTP sign-in, responsive search, seat selection, reloadable unpaid holds and release are live. OTP sends through the verified `jacked.dev` domain. The owned hostname is live, with Google and email OTP verified through real mobile and desktop booking flows. See the [domain cutover evidence](docs/domain-cutover.md). No live tickets or payments. See the [release evidence and operations guide](docs/release-v0.md).

## Run locally

Use Node 24.14.0 and pnpm 10.34.5. Copy `.env.example` to an ignored `.env` and configure a **dedicated development** Neon database. `DATABASE_URL` uses a pooled DML-only application role; `MIGRATION_DATABASE_URL` uses the direct owner/migration connection. Set a random secret of at least 32 bytes. Keep credentials out of Git and chat.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm db:migrate
pnpm db:seed
docker run -d --name quickbus-mailpit -p 127.0.0.1:8025:8025 axllent/mailpit:v1.27.8
pnpm dev
```

If the local inbox container already exists, use `docker start quickbus-mailpit` instead of creating it again. Open [KwikBus](http://localhost:3000); the local inbox is at [Mailpit](http://localhost:8025). Seed adds future Bengaluru/Hyderabad journeys idempotently without deleting reservations. Rerun it when the demo timetable ages out.

`pnpm dev` writes only runtime variables to ignored `apps/api/.dev.vars`, starts Express in Wrangler on port 8787, and starts the web Worker on port 3000. The migration owner URL is never copied to the Worker. Ctrl+C stops both processes.

`pnpm check` first builds the web target to generate its ignored route types, then runs lint and strict TypeScript. It therefore works on a fresh checkout before a dev server has generated routes.

For the second API instance and correctness checks:

```sh
pnpm dev:peer
# In another terminal while both APIs and the web app are running:
pnpm test:integration
pnpm test:contention
pnpm check
pnpm build
```

The contention harness creates only synthetic fixtures, waits for concurrent requests to settle, audits the database independently, and cleans up its own rows. It uses the direct owner connection for fixture setup and a trip-scoped fault trigger; HTTP requests still pass through normal authentication and the restricted runtime role. It refuses to run without explicit local fixture flags. Run it against a disposable development database, never production. While it runs, synthetic trips may briefly appear in the development timetable.

## Implementation evidence

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
- Email must be verified before a hold. The first slice stops at an unpaid reservation. Future payment ambiguity, reconciliation, and refund recovery follow the documented protocol before any checkout is exposed.

## Application identity

The application is **KwikBus**. The production domain is `kwikbus.jacked.dev`; OTP sends from `signin@jacked.dev` through a dedicated restricted Resend key. Cloudflare services use `kwikbus` (web) and `kwikbus-api` (private backend). Existing database identifiers and historical evidence retain their original names until a safe migration is needed.
