# Runtime compatibility proof — 25 October 2026

This records the original Phase 0 compatibility baseline. It is not a production launch certification. The subsequent [V0 preview release](release-v0.md) is now deployed on Cloudflare and replaces the original magic-link customer login with Google and email OTP. Historical measurements below remain evidence of that earlier slice.

## Pinned matrix

| Component | Version / decision |
|---|---|
| Local tooling | Node 24.14.0; pnpm 10.34.5; Turborepo 2.11.10 |
| Workers tooling | Wrangler 4.152.0; Cloudflare Vite plugin 1.65.0 |
| Workers compatibility date | 2026-10-25; Node compatibility is automatic for this date |
| Web | TanStack Start 1.169.4; Router 1.170.46; React 19.3.1; Vite 8.3.5 |
| API | Express 5.3.0 through `cloudflare:node` `httpServerHandler` |
| Database | Dedicated Neon development project; PostgreSQL 18; AWS Singapore |
| Data access | Drizzle ORM 0.45.4; Neon serverless driver 1.2.0 |
| Migrations | Drizzle Kit 0.31.11; node-postgres 8.23.1; direct connection |
| Identity | Better Auth / Drizzle adapter 1.7.12; explicitly hashed magic links |
| Request validation | Zod 4.6.7 |

The lockfile is authoritative for transitive versions. Dependencies were installed with lifecycle scripts disabled. The native binaries supplied by the packages worked without blanket script approval.

## Observed behavior

- Start performs SSR inside Workers and reaches Express through the `API` service binding. Cookie forwarding and two simultaneous customers' SSR responses remain isolated. Personalized HTML has `Cache-Control: private, no-store`.
- The Express HTTP adapter preserves request-scoped async context. Each invocation creates one Neon WebSocket pool with `max: 1`, uses it for the request, and closes it afterward. There is no module-global database connection. Idle socket errors have an explicit safe event handler; a real backend-termination test verifies that the pool reports the failure and replaces its connection without an uncaught exception.
- A real interactive transaction retained its PostgreSQL backend PID. An injected rollback removed its writes and temporary table. Pooled connections preserve a transaction's session and row locks.
- The application role has no superuser, create-database, create-role, or public-schema creation privilege. It can read the timetable, lock a trip through a narrow column UPDATE privilege, and mutate the reservation/authentication tables. Owner credentials are retained only in the ignored local migration/fixture configuration.
- Both migrations were applied to the new development database. The migrator uses the direct URL and a session advisory lock to serialize migration runners.
- The two-instance contention proof and independent inventory audit are recorded in [the reservation evidence](reservation-proof.md). They are correctness evidence, not a latency SLO or production load certification.
- Browser sign-in used the local Mailpit inbox. Concurrent redemption produced exactly one new session. The stored verifier identifier differs from the raw token.

## Commands

With the local environment configured as described in the README:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm db:migrate
pnpm db:seed
pnpm dev
```

In a second terminal, start the other API instance. Its persistence directory is isolated with `--persist-to .wrangler/api-peer-state`; sharing the default directory caused a local SQLite lock failure during reload:

```sh
pnpm dev:peer
```

Then run `pnpm check`, `pnpm build`, `pnpm test:integration`, and `pnpm test:contention`. The tests intentionally contact the dedicated Neon development database. The fixture guard requires both `DEPLOYMENT_ENV=local` and `ALLOW_DEV_FIXTURES=true`. Never point it at production. The contention harness temporarily creates a trigger scoped to one synthetic trip to inject a write failure and removes it in `finally`.

The direct URL is used only by migration/fixture tooling. The pooled URL, auth secret, app origin, deployment mode, and local-mailbox URL are the only values copied to the API's ignored `.dev.vars`. The web Worker receives a service binding, not database credentials.

## Original spike gates (historical; reconciled below)

- Admin role enforcement and fresh MFA step-up: enabling the library's two-factor plugin alone does **not** protect a magic-link login or an admin action. No admin mutation endpoint is exposed in this slice.
- Production email transport, public-domain cookie/CSRF verification, configuration validation, callback-query log redaction, edge/principal rate limits, and full observability.
- Normalized editable catalog, atomic publication, boarding/drop-off snapshots, checkout details, durable jobs, and the complete booking lifecycle.
- Provider contract spike, payment intents/attempts, reconciliation, refunds, and tickets. There is no payment or confirmed-ticket code.
- Remote Workers smoke, CI, load/latency budgets, restore/recovery exercise, and complete accessibility review.

`pnpm build` succeeds for both Worker targets. Vite emits an upstream CSS sourcemap warning in the SSR build; CSS output renders, but CSS source mapping is not certified. The dependency audit's Zod high-severity issue was removed by pinning 4.6.7. One moderate esbuild advisory remains under Drizzle Kit's deprecated esbuild-kit loader. That code is used for CLI transforms, not an esbuild development server or the Worker request path; do not expose a server from that legacy package. It remains tracked rather than suppressed.

## Current gate reconciliation — 26 October 2026

Production email, owned-domain cookies/CSRF, runtime configuration validation, callback-query log suppression, remote Workers smoke and build/type/lint/audit CI have since passed. Customer authentication uses Google and email OTP; the earlier magic-link spike is not the shipped public surface. Admin MFA remains deferred with admin access. Correlated telemetry, automated isolated-DB CI, scheduled jobs, measured performance and restore/recovery are active [P0 work](../tasks/p0-hardening.md). Full catalog/publication, checkout and paid lifecycle acceptance remain open.

## Primary references

- [Cloudflare Express adapter](https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/)
- [Workers Node HTTP support](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)
- [TanStack Start on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)
- [Pool idle-error events](https://node-postgres.com/apis/pool#events)
- [Neon per-invocation pool requirements](https://neon.com/docs/serverless/serverless-driver#pool-and-client-usage-notes)
- [Drizzle with Neon](https://orm.drizzle.team/docs/connect-neon)
- [Better Auth Express integration](https://better-auth.com/docs/integrations/express), [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [magic links](https://better-auth.com/docs/plugins/magic-link), [two-factor limitations](https://better-auth.com/docs/plugins/2fa)
- [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [esbuild advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99)

## Local role grants

For a fresh dedicated development project, create a login role named `quickbus_runtime` in Neon, apply migrations with the direct owner URL, and run the following as that owner. Store the generated runtime credential only in the local pooled URL. The schema-creation privilege test must remain false; do not make the runtime role an owner or grant it membership in the migration role.

```sql
GRANT USAGE ON SCHEMA public TO quickbus_runtime;
GRANT SELECT ON trips, trip_seats TO quickbus_runtime;
GRANT UPDATE(sales_state) ON trips TO quickbus_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "user", session, account, verification, two_factor, rate_limit,
  bookings, booking_items, seat_allocations, idempotency_keys, booking_events
TO quickbus_runtime;
```

Future migrations must review grants for new tables explicitly. This grant set describes the current unpaid development slice; it is not permission to reuse the development credentials in production.
