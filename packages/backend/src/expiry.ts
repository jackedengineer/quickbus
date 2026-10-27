import type { Database, Transaction } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';

// Caller must hold the trip row lock. Events, ownership removal and state change
// are one statement in the caller's transaction; no external service is involved.
export async function expireTripHolds(
  tx: Transaction,
  tripId: string,
  timestamp: string,
) {
  const result = await tx.execute<{ expired: number }>(sql`
    WITH expired AS (
      UPDATE bookings SET status='EXPIRED'
      WHERE trip_id=${tripId} AND status IN ('HELD','PAYMENT_PENDING') AND expires_at<=${timestamp}::timestamptz RETURNING id
    ), released AS (
      DELETE FROM seat_allocations USING expired WHERE booking_id=expired.id RETURNING booking_id
    ), events AS (
      INSERT INTO booking_events(id,booking_id,type)
      SELECT gen_random_uuid(),id,'EXPIRED' FROM expired RETURNING id
    ) SELECT count(*)::int AS expired FROM events`);
  return result.rows[0].expired;
}

export async function sweepExpiredHolds(db: Database) {
  // This read is a hint only. Expiry eligibility is rechecked with DB time after
  // the same serialization lock used by customer hold/release commands.
  const candidates = await db.execute<{ id: string }>(sql`
    SELECT t.id FROM trips t WHERE EXISTS (
      SELECT 1 FROM bookings b WHERE b.trip_id=t.id AND b.status IN ('HELD','PAYMENT_PENDING') AND b.expires_at<=clock_timestamp()
    ) ORDER BY t.id LIMIT 10`);
  let expired = 0;
  for (const trip of candidates.rows)
    expired += await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
      const locked = await tx.execute(
        sql`SELECT id FROM trips WHERE id=${trip.id} FOR UPDATE SKIP LOCKED`,
      );
      if (!locked.rowCount) return 0;
      const clock = await tx.execute<{ timestamp: string }>(
        sql`SELECT clock_timestamp()::text AS timestamp`,
      );
      return expireTripHolds(tx, trip.id, clock.rows[0].timestamp);
    });
  return expired;
}
