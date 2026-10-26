import { spawnSync } from 'node:child_process';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getgid, getuid } from 'node:process';
import { pipeline } from 'node:stream/promises';
import { setTimeout } from 'node:timers/promises';
import { rootCertificates } from 'node:tls';
import { isDeepStrictEqual, parseEnv } from 'node:util';
import pg from 'pg';
import {
  countsQuery,
  invariantQuery,
  schemaQuery,
  tablesQuery,
} from './recovery-audit';

if (!process.argv.includes('--production-drill'))
  throw new Error(
    'Explicit --production-drill required; no production restore is supported.',
  );
const settings = parseEnv(await readFile('.env.production', 'utf8'));
if (
  !settings.MIGRATION_DATABASE_URL ||
  settings.DEPLOYMENT_ENV !== 'production'
)
  throw new Error('Production source configuration required.');
const sourceUrl = new URL(settings.MIGRATION_DATABASE_URL);
if (
  sourceUrl.hostname.includes('-pooler') ||
  sourceUrl.pathname !== '/kwikbus_v0' ||
  sourceUrl.searchParams.get('sslmode') !== 'verify-full'
)
  throw new Error('A verified direct production source is required.');
const image =
  'postgres@sha256:edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6';
const nonce = randomBytes(6).toString('hex');
const directory = resolve(
  `artifacts/local/recovery/${new Date().toISOString().replaceAll(':', '-')}-${nonce}`,
);
const container = `kwikbus-restore-${nonce}`;
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
const log = await open(`${directory}/private-tool.log`, 'w', 0o600);
const run = (args: string[], capture = false) => {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', capture ? 'pipe' : log.fd, log.fd],
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(
      'Recovery tool failed; inspect the private log, never paste its contents publicly.',
    );
  return result.stdout?.trim() ?? '';
};
const escapePass = (value: string) =>
  value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
const source = new pg.Client({
  connectionString: settings.MIGRATION_DATABASE_URL,
  connectionTimeoutMillis: 10000,
});
const started = performance.now();
let exported = false;
try {
  await source.connect();
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const snapshot = (
    await source.query(
      'SELECT pg_export_snapshot() snapshot,clock_timestamp() snapshot_at',
    )
  ).rows[0];
  exported = true;
  const tables = (await source.query(tablesQuery)).rows as {
    schemaname: string;
    name: string;
  }[];
  const countSql = countsQuery(tables);
  const expectedCounts = (await source.query(countSql)).rows[0].value;
  const expectedSchema = (await source.query(schemaQuery)).rows[0].value;
  const expectedInvariants = (await source.query(invariantQuery)).rows[0].value;
  if (Object.values(expectedInvariants).some((v) => v !== 0))
    throw new Error('Source invariants failed; no restore is promoted.');
  // The pinned minimal PostgreSQL image has no system CA bundle. Supply Node's
  // bundled public trust roots explicitly; never downgrade verify-full.
  await writeFile(`${directory}/roots.pem`, rootCertificates.join('\n'), {
    mode: 0o600,
  });
  const service = `[source]\nhost=${sourceUrl.hostname}\nport=${sourceUrl.port || 5432}\ndbname=kwikbus_v0\nuser=${decodeURIComponent(sourceUrl.username)}\nsslmode=verify-full\nsslrootcert=/evidence/roots.pem\n`;
  const password = [
    sourceUrl.hostname,
    sourceUrl.port || '5432',
    'kwikbus_v0',
    decodeURIComponent(sourceUrl.username),
    decodeURIComponent(sourceUrl.password),
  ]
    .map(escapePass)
    .join(':');
  await writeFile(`${directory}/pg_service.conf`, service, { mode: 0o600 });
  await writeFile(`${directory}/source.pgpass`, `${password}\n`, {
    mode: 0o600,
  });
  const dumpStarted = performance.now();
  run([
    'run',
    '--rm',
    '--user',
    `${getuid?.() ?? 0}:${getgid?.() ?? 0}`,
    '-v',
    `${directory}:/evidence`,
    '-e',
    'PGSERVICEFILE=/evidence/pg_service.conf',
    '-e',
    'PGPASSFILE=/evidence/source.pgpass',
    image,
    'pg_dump',
    '--dbname=service=source',
    `--snapshot=${snapshot.snapshot}`,
    '--format=custom',
    '--no-owner',
    '--no-acl',
    '--file=/evidence/kwikbus.dump',
  ]);
  await chmod(`${directory}/kwikbus.dump`, 0o600);
  const backupMs = Math.round(performance.now() - dumpStarted);
  await source.query('COMMIT');
  exported = false;
  const restoreStarted = performance.now();
  // The restore target has no network and no published port. Production is never
  // a restore destination. Its only input is the read-only snapshot archive.
  run([
    'run',
    '-d',
    '--name',
    container,
    '--network',
    'none',
    '--tmpfs',
    '/var/lib/postgresql',
    '-e',
    'POSTGRES_DB=kwikbus_restore',
    '-e',
    'POSTGRES_PASSWORD=restore-fixture-only',
    '-v',
    `${directory}:/evidence:ro`,
    image,
  ]);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const probe = spawnSync(
      'docker',
      [
        'exec',
        container,
        'pg_isready',
        '-U',
        'postgres',
        '-d',
        'kwikbus_restore',
      ],
      { stdio: 'ignore' },
    );
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await setTimeout(1000);
  }
  if (!ready) throw new Error('Isolated restore target did not start.');
  run([
    'exec',
    container,
    'pg_restore',
    '-U',
    'postgres',
    '-d',
    'kwikbus_restore',
    '--exit-on-error',
    '--no-owner',
    '--no-acl',
    '/evidence/kwikbus.dump',
  ]);
  const target = (query: string) =>
    JSON.parse(
      run(
        [
          'exec',
          container,
          'psql',
          '-U',
          'postgres',
          '-d',
          'kwikbus_restore',
          '-XAt',
          '-c',
          query,
        ],
        true,
      ),
    );
  const actualCounts = target(countSql),
    actualSchema = target(schemaQuery),
    actualInvariants = target(invariantQuery);
  if (
    !isDeepStrictEqual(actualCounts, expectedCounts) ||
    !isDeepStrictEqual(actualSchema, expectedSchema) ||
    !isDeepStrictEqual(actualInvariants, expectedInvariants)
  )
    throw new Error('Restored schema/count/invariant audit mismatch.');
  const restoreAndAuditMs = Math.round(performance.now() - restoreStarted);
  const key = randomBytes(32),
    iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  await pipeline(
    createReadStream(`${directory}/kwikbus.dump`),
    cipher,
    createWriteStream(`${directory}/kwikbus.dump.aesgcm`, { mode: 0o600 }),
  );
  await writeFile(
    `${directory}/recovery-key.json`,
    JSON.stringify({
      algorithm: 'aes-256-gcm',
      key: key.toString('hex'),
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
    }),
    { mode: 0o600 },
  );
  await rm(`${directory}/kwikbus.dump`);
  const evidence = {
    source: 'consistent read-only production snapshot; direct verified TLS',
    target:
      'disposable PostgreSQL 18 container with --network none; never promoted',
    snapshotAt: snapshot.snapshot_at,
    verifiedAt: new Date().toISOString(),
    snapshotAgeAtVerificationMs: Math.max(
      0,
      Date.now() - new Date(snapshot.snapshot_at).getTime(),
    ),
    backupMs,
    restoreAndAuditMs,
    totalDrillMs: Math.round(performance.now() - started),
    tablesCompared: tables.length,
    rowsCompared: Object.values(expectedCounts).reduce(
      (a: number, b) => a + Number(b),
      0,
    ),
    schemaSha256: createHash('sha256')
      .update(JSON.stringify(expectedSchema))
      .digest('hex'),
    schemaCountsAndInvariantsMatch: true,
    invariants: actualInvariants,
    encryptedArchive:
      'private ignored AES-256-GCM archive; key stored separately in the same restricted local directory',
    limits:
      'One portable snapshot drill, not continuous offsite backup or an RPO/RTO service guarantee. No production database was replaced.',
  };
  await writeFile(
    `${directory}/evidence.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (exported) await source.query('ROLLBACK').catch(() => {});
  await source.end();
  spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
  await Promise.all(
    ['pg_service.conf', 'source.pgpass', 'roots.pem'].map((name) =>
      rm(`${directory}/${name}`, { force: true }),
    ),
  );
  await log.close();
}
