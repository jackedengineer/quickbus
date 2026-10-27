import { expect, test } from 'vitest';
import {
  maintenanceHealth,
  runMaintenance,
} from '../../packages/backend/src/maintenance';
import { createDatabase } from '../../packages/db/src/client';
import { fixtureClient } from '../support/fixtures';

test('payment worker freshness is measured by real work and remains required with admission disabled', async () => {
  const owner = await fixtureClient(),
    runtime = createDatabase(
      process.env.DATABASE_URL ?? '',
      process.env.CI_DATABASE_PROXY,
    );
  const prior = (
    await owner.query("SELECT * FROM maintenance_jobs WHERE name='payments'")
  ).rows[0];
  try {
    await owner.query(
      "INSERT INTO maintenance_jobs(name,last_succeeded_at) VALUES('payments',clock_timestamp()-interval '11 minutes') ON CONFLICT(name) DO UPDATE SET last_succeeded_at=excluded.last_succeeded_at",
    );
    expect((await maintenanceHealth(runtime.db, true)).paymentsFresh).toBe(
      false,
    );
    expect((await maintenanceHealth(runtime.db, true)).status).toBe('degraded');
    expect((await maintenanceHealth(runtime.db, false)).paymentsFresh).toBe(
      true,
    );
    // No provider configured and no exposure in this fixture: a real empty pass.
    await runMaintenance(runtime.db, 'payments');
    expect((await maintenanceHealth(runtime.db, true)).paymentsFresh).toBe(
      true,
    );
  } finally {
    if (prior)
      await owner.query(
        'UPDATE maintenance_jobs SET last_started_at=$1,last_succeeded_at=$2,last_failed_at=$3,last_processed=$4 WHERE name=$5',
        [
          prior.last_started_at,
          prior.last_succeeded_at,
          prior.last_failed_at,
          prior.last_processed,
          'payments',
        ],
      );
    else
      await owner.query("DELETE FROM maintenance_jobs WHERE name='payments'");
    await runtime.close();
    await owner.end();
  }
});
