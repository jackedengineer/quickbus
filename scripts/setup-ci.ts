import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { migrateDatabase } from '../packages/db/src/migrate';
import { seedDemoInventory } from './demo-inventory';
import { applyRuntimeGrants } from './runtime-grants';

// This setup never reads .env/.env.production or accepts a remote target.
const ownerUrl =
  'postgresql://postgres:fixture-owner-only@127.0.0.1:55432/quickbus_ci?sslmode=disable';
await migrateDatabase(ownerUrl);
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
try {
  await owner.query(
    "CREATE ROLE quickbus_runtime LOGIN PASSWORD 'fixture-runtime-only'",
  );
  await applyRuntimeGrants(owner, 'quickbus_runtime');
  await seedDemoInventory(owner, 30);
  // Prove additive migration replay is safe on the same database.
  await migrateDatabase(ownerUrl);
  const environment = [
    `MIGRATION_DATABASE_URL=${ownerUrl}`,
    'DATABASE_URL=postgresql://quickbus_runtime:fixture-runtime-only@127.0.0.1:55432/quickbus_ci?sslmode=disable',
    'CI_DATABASE_PROXY=127.0.0.1:6543',
    `AUTH_SECRET=${randomBytes(32).toString('hex')}`,
    'APP_ORIGIN=http://localhost:3000',
    'API_ORIGIN=http://localhost:8787',
    'DEPLOYMENT_ENV=local',
    'ALLOW_DEV_FIXTURES=true',
    'MAILPIT_URL=http://127.0.0.1:8025',
  ].join('\n');
  await writeFile('.env.ci', `${environment}\n`, { mode: 0o600 });
  console.log(
    'Isolated fixture database migrated, restricted role granted and DB-backed inventory seeded.',
  );
} finally {
  await owner.end();
}
