import type { CancellationPreview } from '@kwikbus/contracts';
import type { Database, Transaction } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import { failure, idempotent, lockTrip } from './commands';
import { enqueueBookingNotification } from './notification-queue';
import { ensureRefund } from './payment-state';
import { isoInstant } from './presentation';

// Policy v1 is immutable: >= two hours before the trip's first departure.
// Later policy versions must not change this accepted rule for existing bookings.
export async function cancellationPreview(
  db: Database,
  userId: string,
  id: string,
) {
  const row = (
    await db.execute<CancellationPreview>(sql`SELECT b.id,b.status,b.version,b.cancellation_policy_version AS "policyVersion",
   t.departure_at-interval '2 hours' AS "cutoffAt",statement_timestamp() AS "serverTime",
   (b.status='CONFIRMED' AND b.cancellation_policy_version=1 AND t.sales_state<>'CANCELLED' AND t.departure_at-interval '2 hours'>=statement_timestamp()) AS eligible,
   CASE WHEN b.status='CONFIRMED' THEN b.total_minor ELSE coalesce(c.refund_minor,0) END AS "refundableMinor",c.source
   FROM bookings b JOIN trips t ON t.id=b.trip_id LEFT JOIN booking_cancellations c ON c.booking_id=b.id
   WHERE b.id=${id} AND b.user_id=${userId}`)
  ).rows[0];
  return row
    ? {
        ...row,
        cutoffAt: isoInstant(row.cutoffAt),
        serverTime: isoInstant(row.serverTime),
      }
    : null;
}

// Caller MUST hold the trip lock. All allocations, history, refund intent and
// notification writes commit together; the provider call is left to its worker.
export async function cancelLockedBooking(
  tx: Transaction,
  id: string,
  actor: string,
  source: 'CUSTOMER' | 'TRIP',
) {
  const b = (
    await tx.execute<{ status: string; total: number; policy: number }>(
      sql`SELECT status,total_minor AS total,cancellation_policy_version AS policy FROM bookings WHERE id=${id}`,
    )
  ).rows[0];
  if (!b || !['HELD', 'PAYMENT_PENDING', 'CONFIRMED'].includes(b.status))
    return false;
  if (b.status === 'CONFIRMED') {
    const paid = (
      await tx.execute<{
        id: string;
        amount: number;
        currency: string;
      }>(sql`SELECT p.id,p.amount,p.currency FROM provider_payments p JOIN payment_intents i ON i.id=p.intent_id
     WHERE i.booking_id=${id} AND p.disposition='FULFILLED'`)
    ).rows;
    if (
      paid.length !== 1 ||
      paid[0].amount !== b.total ||
      paid[0].currency !== 'INR'
    )
      throw new Error('Confirmed booking financial invariant failed');
    await tx.execute(
      sql`UPDATE provider_payments SET disposition='REFUND',updated_at=clock_timestamp() WHERE id=${paid[0].id}`,
    );
    await ensureRefund(tx, paid[0].id, paid[0].amount);
  }
  await tx.execute(sql`INSERT INTO booking_cancellations(booking_id,source,actor,policy_version,refund_minor)
   VALUES(${id},${source},${actor},${b.policy},${b.status === 'CONFIRMED' ? b.total : 0})`);
  await tx.execute(sql`UPDATE bookings SET status='CANCELLED' WHERE id=${id}`);
  await tx.execute(sql`DELETE FROM seat_allocations WHERE booking_id=${id}`);
  await tx.execute(
    sql`INSERT INTO booking_events(id,booking_id,type) VALUES(${crypto.randomUUID()},${id},'CANCELLED') ON CONFLICT DO NOTHING`,
  );
  // Only frozen, paid details have an immutable recipient. Unpaid trip drain
  // retains its timeline without attempting delivery to a missing contact.
  if (b.status === 'CONFIRMED')
    await enqueueBookingNotification(tx, id, 'CANCELLED');
  return true;
}
export async function cancelCustomerBooking(
  db: Database,
  userId: string,
  id: string,
  key: string,
  version: number,
) {
  return idempotent(
    db,
    userId,
    `POST /api/v1/bookings/${id}/cancel`,
    key,
    { version, policyVersion: 1 },
    async (tx) => {
      const initial = (
        await tx.execute<{ tripId: string }>(
          sql`SELECT trip_id AS "tripId" FROM bookings WHERE id=${id} AND user_id=${userId}`,
        )
      ).rows[0];
      if (!initial)
        return failure(
          'BOOKING_NOT_FOUND',
          'Booking not found for this account.',
          404,
        );
      const trip = await lockTrip(tx, initial.tripId);
      if (!trip) return failure('BOOKING_NOT_FOUND', 'Booking not found.', 404);
      const current = (
        await tx.execute<{
          status: string;
          version: number;
          policy: number;
          eligible: boolean;
          cancelled: boolean;
        }>(sql`SELECT b.status,b.version,b.cancellation_policy_version AS policy,
     t.departure_at-interval '2 hours'>=${trip.timestamp}::timestamptz AS eligible,
     EXISTS(SELECT 1 FROM booking_cancellations WHERE booking_id=b.id) AS cancelled
     FROM bookings b JOIN trips t ON t.id=b.trip_id WHERE b.id=${id}`)
      ).rows[0];
      if (current.status === 'CANCELLED' && current.cancelled)
        return {
          status: 200,
          body: { id, status: 'CANCELLED' },
        };
      if (current.status !== 'CONFIRMED')
        return failure(
          'BOOKING_NOT_CONFIRMED',
          'Only a confirmed booking uses paid cancellation. Open its current status.',
        );
      if (current.version !== version)
        return failure(
          'VERSION_CONFLICT',
          'This booking changed. Review the current cancellation details.',
          412,
        );
      if (trip.sales_state === 'CANCELLED')
        return failure(
          'TRIP_CANCELLED',
          'This trip has been cancelled. Your booking and refund are being updated.',
        );
      if (current.policy !== 1 || !current.eligible)
        return failure(
          'CANCELLATION_CLOSED',
          'Cancellation closes two hours before the trip’s first departure.',
        );
      await cancelLockedBooking(tx, id, userId, 'CUSTOMER');
      return {
        status: 200,
        body: { id, status: 'CANCELLED' },
      };
    },
  );
}
