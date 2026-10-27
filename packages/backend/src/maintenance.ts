import type { Database } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import { sweepExpiredHolds } from './expiry';
import { renewInventory } from './inventory';
import { paymentJobHealth } from './payment-jobs';
import { runPaymentJobs } from './payment-worker';
import type { RazorpayEnvironment } from './razorpay';

export async function runMaintenance(
  db: Database,
  name: 'expiry' | 'inventory' | 'payments',
  runId = crypto.randomUUID(),
  environment: RazorpayEnvironment = {},
) {
  const started = performance.now();
  try {
    await db.execute(sql`INSERT INTO maintenance_jobs(name,last_started_at) VALUES(${name},clock_timestamp())
    ON CONFLICT(name) DO UPDATE SET last_started_at=excluded.last_started_at`);
    const processed = await (name === 'expiry'
      ? sweepExpiredHolds(db)
      : name === 'inventory'
        ? renewInventory(db)
        : runPaymentJobs(db, environment));
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

export async function maintenanceHealth(
  db: Database,
  paymentsConfigured = false,
) {
  const result = await db.execute<{
    expiryFresh: boolean;
    inventoryFresh: boolean;
    horizonHealthy: boolean;
    overdueHolds: number;
    paymentsFresh: boolean;
  }>(sql`SELECT
    coalesce((SELECT last_succeeded_at>clock_timestamp()-interval '10 minutes' FROM maintenance_jobs WHERE name='expiry'),false) AS "expiryFresh",
    coalesce((SELECT last_succeeded_at>clock_timestamp()-interval '3 hours' FROM maintenance_jobs WHERE name='inventory'),false) AS "inventoryFresh",
    coalesce((SELECT bool_and(coalesce(latest.departure>clock_timestamp()+interval '27 days',false))
      FROM inventory_services s LEFT JOIN LATERAL (SELECT max(departure_at) departure FROM trips WHERE source_service_id=s.id AND sales_state='OPEN') latest ON true WHERE s.active),false) AS "horizonHealthy",
    (SELECT count(*)::int FROM bookings WHERE status IN ('HELD','PAYMENT_PENDING') AND expires_at<clock_timestamp()-interval '5 minutes') AS "overdueHolds",
    (NOT ${paymentsConfigured} OR coalesce((SELECT last_succeeded_at>clock_timestamp()-interval '10 minutes' FROM maintenance_jobs WHERE name='payments'),false)) AS "paymentsFresh"`);
  const values = result.rows[0];
  const payments = await paymentJobHealth(db);
  const cases = await db.execute<{ open: number }>(
    sql`SELECT count(*)::int AS open FROM payment_cases WHERE state='OPEN'`,
  );
  return {
    status:
      values.expiryFresh &&
      values.inventoryFresh &&
      values.horizonHealthy &&
      values.paymentsFresh &&
      !values.overdueHolds &&
      !payments.failed &&
      payments.oldestSeconds < 180 &&
      !cases.rows[0].open
        ? 'ok'
        : 'degraded',
    ...values,
    payments: { ...payments, openCases: cases.rows[0].open },
  };
}
