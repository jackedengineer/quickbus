import type { Database } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import { sweepExpiredHolds } from './expiry';

export async function runMaintenance(db: Database, name: 'expiry') {
  const runId = crypto.randomUUID(),
    started = performance.now();
  try {
    await db.execute(sql`INSERT INTO maintenance_jobs(name,last_started_at) VALUES(${name},clock_timestamp())
    ON CONFLICT(name) DO UPDATE SET last_started_at=excluded.last_started_at`);
    const processed = await sweepExpiredHolds(db);
    await db.execute(
      sql`UPDATE maintenance_jobs SET last_succeeded_at=clock_timestamp(),last_processed=${processed} WHERE name=${name}`,
    );
    console.log(
      JSON.stringify({
        event: 'maintenance_completed',
        requestId: runId,
        job: name,
        processed,
        durationMs: Math.round(performance.now() - started),
      }),
    );
    return processed;
  } catch {
    // If the database itself is unavailable, the failure event still survives in
    // Workers Logs and the unadvanced success heartbeat is detected externally.
    await db
      .execute(
        sql`UPDATE maintenance_jobs SET last_failed_at=clock_timestamp() WHERE name=${name}`,
      )
      .catch(() => {});
    console.error(
      JSON.stringify({
        event: 'maintenance_failed',
        requestId: runId,
        job: name,
      }),
    );
    throw new Error('Scheduled maintenance failed.');
  }
}
