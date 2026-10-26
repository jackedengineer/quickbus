# Controlled production releases

Quality CI runs on main and codex branches. Besides build/type/lint/unit/audit checks, it creates an isolated PostgreSQL 18 database from empty, applies migrations twice, grants a restricted runtime role, seeds database service definitions and exercises two real Workers through Neon's WebSocket proxy. It runs the integration suite and the 100-customer contention proof. These fixtures are not production Neon and do not establish Neon throughput; actual Neon evidence remains separate.

CI uses pinned PostgreSQL/proxy image digests, loopback-only published ports and a private Docker network. The proxy can forward only to its fixture PostgreSQL container. Plain WebSocket transport is accepted only for the exact loopback `quickbus_ci` database/port and is forbidden by production configuration validation. The CI database allows 250 connections so a 100-request correctness burst does not test PostgreSQL's default 100-connection capacity ceiling. The runtime has no DDL, owner or role-management privilege and cannot edit service definitions. No production secrets are needed by this workflow.

## Local reproduction

Stop the application's local servers/inbox first; the harness refuses occupied app ports. Do not overwrite `.env` with CI values.

```sh
docker compose -f infra/compose.ci.yml up -d --wait
node --import tsx scripts/setup-ci.ts
node scripts/ci-integration.mjs
docker compose -f infra/compose.ci.yml down --volumes
```

The generated `.env.ci`, runtime vars and fixture logs remain ignored. Restart the normal inbox and `pnpm dev` afterward; the dev launcher restores its allowlisted runtime configuration from `.env`. Fixture code refuses production database names even if local flags are accidentally enabled.

## Release

Review the commits and verify the actual browser flows before merging. Merge by fast-forward to main, push and wait for that exact revision's Quality run. With the existing local Wrangler authorization and ignored `.env.production` configured:

```sh
node --import tsx scripts/release.ts --production --revision <full-main-commit> --ci-run <successful-Quality-run-id> --apply-migrations
```

Omit `--apply-migrations` when the reviewed schema/grants/service bootstrap are already applied. The script requires a clean main checkout equal to the pushed remote and successful exact-revision CI. A direct PostgreSQL advisory lock serializes release operators. The migrator separately serializes all migration runners. Production builds precede private API then web deployment. The guard captures previous/new Worker versions and source/CI identity under private ignored `artifacts/local/releases/`.

The production environment is never bulk-uploaded or passed wholesale into Wrangler. Existing runtime secrets persist. Owner access stays in local migration/backup tooling; the API receives only its restricted role. Initial maintenance performs real runtime-role expiry/renewal while Cron configuration propagates; a later scheduled invocation must advance each success heartbeat independently.

HTTP probes are necessary but do not complete release acceptance. Use the normal HTTPS site in the browser: guest selection → Google/email OTP → restored selection → reserve → full reload → release, desktop/mobile. Verify no unexpected console/network failures, motion/reduced-motion, legacy read redirects, wrong-origin mutation rejection and the private API. Record evidence and tag only after those checks.

## Compatible rollback

Use the previous version IDs captured by the release. Review that both versions use the current canonical origin and remain compatible with the additive schema. Never automatically reverse migrations, delete new reservations or restore a database over production.

```sh
pnpm exec wrangler rollback <previous-api-version> -c apps/api/wrangler.jsonc --env production
pnpm exec wrangler rollback <previous-web-version> -c apps/web/wrangler.jsonc
```

Check normal HTTPS and a real browser flow. To restore the exact newer versions without rebuilding, use `wrangler versions deploy <version>@100% --yes` for API then web with the corresponding config/environment. Trigger configuration is separate operational state: an older Worker without a scheduled handler cannot process the newer cron schedules. Keep such a drill brief and restore the scheduled-handler version promptly; investigate failed Cron events rather than ignoring them.

A live compatibility drill records actual times and source/Worker IDs. The separate [database recovery drill](recovery.md) restores only to an isolated disposable target.
