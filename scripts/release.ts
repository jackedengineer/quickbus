import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { backfillTripCatalog } from './catalog-seed';

const canonical = 'https://kwikbus.jacked.dev';
const git = (...args: string[]) =>
  execFileSync('git', args, { encoding: 'utf8' }).trim();
const revision = git('rev-parse', 'HEAD');
const args = process.argv.slice(2);
const expected = args[args.indexOf('--revision') + 1];
const ciRun = args[args.indexOf('--ci-run') + 1];
const migrate = args.includes('--apply-migrations');
if (
  !args.includes('--production') ||
  expected !== revision ||
  !/^\d+$/.test(ciRun ?? '')
)
  throw new Error(
    'Use --production --revision <exact HEAD> --ci-run <successful Quality run ID> [--apply-migrations].',
  );
if (
  git('status', '--porcelain') ||
  git('branch', '--show-current') !== 'main' ||
  git('rev-parse', 'origin/main') !== revision ||
  git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0] !== revision
)
  throw new Error(
    'Release requires a clean main checkout equal to the pushed origin/main.',
  );
const ci = (await (
  await fetch(
    `https://api.github.com/repos/jackedengineer/quickbus/actions/runs/${ciRun}`,
    {
      headers: {
        'User-Agent': 'KwikBus-release',
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(15000),
    },
  )
).json()) as {
  head_sha?: string;
  name?: string;
  conclusion?: string;
  status?: string;
};
if (
  ci.head_sha !== revision ||
  ci.name !== 'Quality' ||
  ci.status !== 'completed' ||
  ci.conclusion !== 'success'
)
  throw new Error('The exact release revision has not passed Quality CI.');
const settings = parseEnv(await readFile('.env.production', 'utf8'));
if (!settings.MIGRATION_DATABASE_URL || !settings.DATABASE_URL)
  throw new Error('Production database configuration is incomplete.');
const owner = new URL(settings.MIGRATION_DATABASE_URL);
const runtime = new URL(settings.DATABASE_URL);
if (
  settings.DEPLOYMENT_ENV !== 'production' ||
  settings.APP_ORIGIN !== canonical ||
  settings.CI_DATABASE_PROXY ||
  settings.MAILPIT_URL ||
  settings.ALLOW_DEV_FIXTURES ||
  owner.hostname.includes('-pooler') ||
  owner.pathname !== '/kwikbus_v0' ||
  runtime.pathname !== owner.pathname ||
  runtime.username !== 'kwikbus_v0_runtime' ||
  runtime.searchParams.get('sslmode') !== 'verify-full'
)
  throw new Error(
    'Production environment does not match the approved isolated database/origin.',
  );
const apiRoot = JSON.parse(await readFile('apps/api/wrangler.jsonc', 'utf8'));
const webRoot = JSON.parse(await readFile('apps/web/wrangler.jsonc', 'utf8'));
const apiConfig = apiRoot.env.production;
const webConfig = webRoot.env.production;
for (const observability of [
  apiConfig.observability ?? apiRoot.observability,
  webConfig.observability ?? webRoot.observability,
])
  if (
    observability?.redact_query_string !== true ||
    observability?.logs?.invocation_logs !== false
  )
    throw new Error(
      'Worker URL query redaction and invocation-log policy required.',
    );
if (
  apiConfig.vars.APP_ORIGIN !== canonical ||
  webConfig.vars.PUBLIC_ORIGIN !== canonical ||
  apiConfig.workers_dev !== false ||
  apiConfig.preview_urls !== false
)
  throw new Error(
    'Reviewed canonical origin/private API configuration required.',
  );
function run(
  command: string,
  commandArgs: string[],
  environment?: Record<string, string>,
) {
  // Never pass settings wholesale: it contains the migration owner's credential.
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    env: { ...process.env, ...environment },
  });
  if (result.status !== 0)
    throw new Error(
      'Release step failed; retain the evidence and follow the recovery runbook.',
    );
}
function versions(config: string, api = false) {
  const output = execFileSync(
    'pnpm',
    [
      'exec',
      'wrangler',
      'deployments',
      'list',
      '-c',
      config,
      ...(api ? ['--env', 'production'] : []),
      '--json',
    ],
    { encoding: 'utf8' },
  );
  const deployments = JSON.parse(output) as {
    created_on: string;
    versions: { version_id: string; percentage: number }[];
  }[];
  const latest = deployments.sort(
    (a, b) => Date.parse(b.created_on) - Date.parse(a.created_on),
  )[0];
  if (
    !latest ||
    latest.versions.length !== 1 ||
    latest.versions[0].percentage !== 100
  )
    throw new Error('A single 100% Worker version is required before release.');
  return latest.versions[0].version_id;
}
await mkdir('artifacts/local/releases', { recursive: true, mode: 0o700 });
const filename = `artifacts/local/releases/${revision.slice(0, 12)}.json`;
const client = new pg.Client({
  connectionString: settings.MIGRATION_DATABASE_URL,
  connectionTimeoutMillis: 10000,
});
await client.connect();
const evidence: {
  revision: string;
  ciRun: string;
  startedAt: string;
  previous?: { api: string; web: string };
  deployed?: { api: string; web: string };
  state: string;
} = {
  revision,
  ciRun,
  startedAt: new Date().toISOString(),
  state: 'preflight',
};
const save = () =>
  writeFile(filename, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
try {
  const lock = await client.query(
    'SELECT pg_try_advisory_lock(74910251) locked',
  );
  if (!lock.rows[0].locked)
    throw new Error('Another production release is running.');
  evidence.previous = {
    api: versions('apps/api/wrangler.jsonc', true),
    web: versions('apps/web/wrangler.jsonc'),
  };
  await save();
  run('pnpm', ['check'], { CLOUDFLARE_ENV: 'production' });
  run('pnpm', ['cf:check']);
  run('pnpm', ['exec', 'vitest', 'run', 'tests/unit']);
  run('pnpm', ['audit', '--audit-level=high']);
  if (migrate) {
    run('node', [
      '--env-file=.env.production',
      '--import',
      'tsx',
      'scripts/migrate.ts',
    ]);
    run('node', [
      '--env-file=.env.production',
      '--import',
      'tsx',
      'scripts/grant-runtime.ts',
    ]);
    run(
      'node',
      [
        '--env-file=.env.production',
        '--import',
        'tsx',
        'scripts/seed-production.ts',
      ],
      { CONFIRM_DEMO_INVENTORY: 'kwikbus_v0' },
    );
  }
  // Real runtime-role work establishes initial job state while Cron propagation
  // settles. Subsequent production cron invocations must advance the heartbeat.
  run(
    'node',
    [
      '--env-file=.env.production',
      '--import',
      'tsx',
      'scripts/prime-maintenance.ts',
    ],
    { CONFIRM_MAINTENANCE: 'kwikbus_v0' },
  );
  evidence.state = 'deploying';
  await save();
  run('pnpm', [
    'exec',
    'wrangler',
    'deploy',
    '-c',
    'apps/api/wrangler.jsonc',
    '--env',
    'production',
  ]);
  if (migrate) {
    // The previous API may have published a legacy-shaped trip while migrations
    // ran. Reconcile after its replacement, before the web consumes stop menus.
    // Each bounded statement commits and releases its trip locks independently.
    await client.query("SET lock_timeout='2s'");
    await client.query("SET statement_timeout='5s'");
    await client.query('SELECT pg_advisory_lock(74910250)');
    try {
      await backfillTripCatalog(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock(74910250)');
    }
    await client.query('RESET lock_timeout');
    await client.query('RESET statement_timeout');
  }
  run('pnpm', [
    'exec',
    'wrangler',
    'deploy',
    '-c',
    'apps/web/dist/server/wrangler.json',
  ]);
  evidence.deployed = {
    api: versions('apps/api/wrangler.jsonc', true),
    web: versions('apps/web/wrangler.jsonc'),
  };
  await save();
  run('node', ['scripts/check-production.mjs']);
  evidence.state = 'http-verified; real browser acceptance still required';
  await save();
  console.log(
    `Release deployed from ${revision}. Verify actual desktop/mobile auth/reservation flows; record evidence before tagging.`,
  );
} catch (error) {
  evidence.state =
    'failed; inspect completed steps before deliberate compatible rollback';
  await save();
  throw error;
} finally {
  await client.end();
}
