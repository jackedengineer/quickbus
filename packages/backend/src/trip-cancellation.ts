import type { Database } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import { cancelLockedBooking } from './cancellation';
import { lockTrip } from './commands';
import {
  enqueuePaymentJob,
  finishPaymentJob,
  type PaymentJob,
  requirePaymentLease,
  StalePaymentLease,
} from './payment-jobs';
export const tripCancellationReasons = [
  'OPERATOR_CANCELLED',
  'SCHEDULE_CORRECTION',
  'DEMO_RECOVERY',
] as const;
export type TripCancellationReason = (typeof tripCancellationReasons)[number];

// Trusted operator entry point only. No public/admin HTTP route is registered.
export async function requestTripCancellation(
  db: Database,
  id: string,
  actor: string,
  reason: TripCancellationReason,
  maxAffected: number,
) {
  if (
    !/^[a-z0-9][a-z0-9:_-]{0,59}$/.test(actor) ||
    !tripCancellationReasons.includes(reason) ||
    !Number.isInteger(maxAffected) ||
    maxAffected < 0 ||
    maxAffected > 10000
  )
    throw Error('Invalid trip cancellation command');
  return db.transaction(async (tx) => {
    const trip = await lockTrip(tx, id);
    if (!trip) throw Error('Trip not found');
    const existing = await tx.execute(
      sql`SELECT trip_id FROM trip_cancellations WHERE trip_id=${id}`,
    );
    if (existing.rowCount) return { id, alreadyRequested: true };
    const valid = await tx.execute(
      sql`SELECT id FROM trips WHERE id=${id} AND departure_at>${trip.timestamp}::timestamptz`,
    );
    if (!valid.rowCount)
      throw Error('This command cannot cancel a departed trip');
    const count = (
      await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM bookings WHERE trip_id=${id} AND status IN ('HELD','PAYMENT_PENDING','CONFIRMED')`,
      )
    ).rows[0].n;
    if (count > maxAffected)
      throw Error('Affected booking count exceeds the reviewed maximum');
    await tx.execute(
      sql`UPDATE trips SET sales_state='CANCELLED' WHERE id=${id}`,
    );
    await tx.execute(
      sql`INSERT INTO trip_cancellations(trip_id,actor,reason) VALUES(${id},${actor},${reason})`,
    );
    await enqueuePaymentJob(tx, 'TRIP_CANCEL', id);
    return { id, alreadyRequested: false, affectedBookings: count };
  });
}
export async function drainTripCancellation(db: Database, job: PaymentJob) {
  return db.transaction(async (tx) => {
    const trip = await lockTrip(tx, job.resourceId);
    await requirePaymentLease(tx, job);
    const record = await tx.execute<{ actor: string }>(
      sql`SELECT actor FROM trip_cancellations WHERE trip_id=${job.resourceId}`,
    );
    if (!trip || trip.sales_state !== 'CANCELLED' || !record.rowCount)
      throw Error('Invalid trip cancellation job');
    // Three bookings bound SQL round-trips well below the 45s lease. Each completed
    // batch commits its refunds/history/progress; a killed batch rolls back whole.
    const rows = (
      await tx.execute<{ id: string }>(
        sql`SELECT id FROM bookings WHERE trip_id=${job.resourceId} AND status IN ('HELD','PAYMENT_PENDING','CONFIRMED') ORDER BY status,created_at,id LIMIT 3`,
      )
    ).rows;
    let processed = 0;
    for (const booking of rows)
      if (
        await cancelLockedBooking(tx, booking.id, record.rows[0].actor, 'TRIP')
      )
        processed++;
    const more = (
      await tx.execute(
        sql`SELECT id FROM bookings WHERE trip_id=${job.resourceId} AND status IN ('HELD','PAYMENT_PENDING','CONFIRMED') LIMIT 1`,
      )
    ).rowCount;
    await tx.execute(
      sql`UPDATE trip_cancellations SET processed_bookings=processed_bookings+${processed},completed_at=CASE WHEN ${Boolean(more)} THEN NULL ELSE clock_timestamp() END WHERE trip_id=${job.resourceId}`,
    );
    if (!(await finishPaymentJob(tx, job, more ? 1 : undefined)))
      throw new StalePaymentLease();
    return processed;
  });
}
export async function tripCancellationStatus(db: Database, id: string) {
  return (
    (
      await db.execute(sql`SELECT t.id,t.sales_state,c.reason,c.requested_at,c.completed_at,c.processed_bookings,j.state AS job_state,j.failure_code,
   (SELECT count(*)::int FROM bookings WHERE trip_id=t.id AND status IN ('HELD','PAYMENT_PENDING','CONFIRMED')) AS remaining_bookings,
   (SELECT count(*)::int FROM payment_refunds r JOIN provider_payments p ON p.id=r.payment_id JOIN payment_intents i ON i.id=p.intent_id JOIN bookings b ON b.id=i.booking_id WHERE b.trip_id=t.id AND r.state<>'PROCESSED') AS outstanding_refunds
   FROM trips t LEFT JOIN trip_cancellations c ON c.trip_id=t.id LEFT JOIN payment_jobs j ON j.kind='TRIP_CANCEL' AND j.resource_id=t.id WHERE t.id=${id}`)
    ).rows[0] ?? null
  );
}
