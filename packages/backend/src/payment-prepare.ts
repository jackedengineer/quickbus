import type { Database } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import { failure, idempotent, lockTrip, validStops } from './commands';
import { enqueuePaymentJob } from './payment-jobs';
import { type RazorpayEnvironment, razorpay } from './razorpay';

export async function preparePayment(
  db: Database,
  environment: RazorpayEnvironment,
  userId: string,
  id: string,
  key: string,
  version: number,
) {
  if (environment.PAYMENTS_ENABLED !== 'true')
    return failure(
      'PAYMENTS_UNAVAILABLE',
      'Test checkout is not available yet.',
      503,
    );
  const provider = razorpay(environment);
  return idempotent(
    db,
    userId,
    `POST /api/v1/bookings/${id}/checkout`,
    key,
    { version },
    async (tx) => {
      const found = await tx.execute<{ tripId: string }>(
        sql`SELECT trip_id AS "tripId" FROM bookings WHERE id=${id} AND user_id=${userId}`,
      );
      if (!found.rows[0])
        return failure('BOOKING_NOT_FOUND', 'Reservation not found.', 404);
      const trip = await lockTrip(tx, found.rows[0].tripId);
      const result = await tx.execute<{
        status: string;
        version: number;
        amount: number;
        currency: string;
        pickup: string | null;
        drop: string | null;
        complete: boolean;
        eligible: boolean;
      }>(sql`
      SELECT b.status,b.version,b.total_minor AS amount,b.currency,b.pickup_stop_id AS pickup,b.drop_stop_id AS drop,
        b.contact_email=u.email AND u.email_verified AND b.pickup_stop_id IS NOT NULL AND b.drop_stop_id IS NOT NULL
        AND EXISTS(SELECT 1 FROM booking_items WHERE booking_id=b.id)
        AND NOT EXISTS(SELECT 1 FROM booking_items WHERE booking_id=b.id AND passenger_name IS NULL)
        AND NOT EXISTS(SELECT 1 FROM booking_items i WHERE i.booking_id=b.id AND NOT EXISTS(
          SELECT 1 FROM seat_allocations a WHERE a.booking_id=i.booking_id AND a.trip_id=i.trip_id AND a.seat_label=i.seat_label)) AS complete,
        b.expires_at>=${trip?.timestamp}::timestamptz+interval '90 seconds' AS eligible
      FROM bookings b JOIN "user" u ON u.id=b.user_id WHERE b.id=${id}`);
      const booking = result.rows[0];
      if (
        !trip ||
        trip.sales_state === 'CANCELLED' ||
        !['HELD', 'PAYMENT_PENDING'].includes(booking.status)
      )
        return failure(
          'RESERVATION_ENDED',
          'This reservation cannot start checkout.',
        );
      if (booking.version !== version)
        return failure(
          'VERSION_CONFLICT',
          'Reload the saved passenger details before paying.',
          412,
        );
      if (!booking.eligible)
        return failure(
          'PAYMENT_DEADLINE',
          'At least 90 seconds must remain to start checkout.',
        );
      if (
        !booking.complete ||
        !booking.pickup ||
        !booking.drop ||
        !(await validStops(
          tx,
          found.rows[0].tripId,
          booking.pickup,
          booking.drop,
        ))
      )
        return failure(
          'DETAILS_INCOMPLETE',
          'Save complete passenger and contact details before paying.',
          422,
        );
      let intent = (
        await tx.execute<{ id: string; keyId: string }>(
          sql`SELECT id,key_id AS "keyId" FROM payment_intents WHERE booking_id=${id}`,
        )
      ).rows[0];
      if (!intent) {
        intent = { id: crypto.randomUUID(), keyId: provider.keyId };
        await tx.execute(
          sql`INSERT INTO payment_intents(id,booking_id,amount,currency,key_id) VALUES(${intent.id},${id},${booking.amount},${booking.currency},${provider.keyId})`,
        );
      }
      if (intent.keyId !== provider.keyId)
        return failure(
          'PAYMENT_CONFIGURATION_CHANGED',
          'Payment recovery needs review.',
          503,
        );
      const prior = (
        await tx.execute<{ id: string; state: string; number: number }>(
          sql`SELECT id,state,number FROM checkout_attempts WHERE intent_id=${intent.id} ORDER BY number DESC LIMIT 1`,
        )
      ).rows[0];
      if (
        prior &&
        ['PENDING', 'CREATING', 'UNKNOWN', 'READY'].includes(prior.state)
      )
        return { status: 202, body: { id, checkoutId: prior.id } };
      if (prior && (prior.state !== 'FAILED' || prior.number >= 10))
        return failure(
          'PAYMENT_RETRY_UNAVAILABLE',
          'Payment recovery is still in progress.',
        );
      const unresolved = await tx.execute(
        sql`SELECT id FROM provider_payments WHERE intent_id=${intent.id} AND state<>'failed' LIMIT 1`,
      );
      if (unresolved.rowCount)
        return failure(
          'PAYMENT_RETRY_UNAVAILABLE',
          'Wait for the existing payment to resolve.',
        );
      const checkoutId = crypto.randomUUID();
      await tx.execute(
        sql`INSERT INTO checkout_attempts(id,intent_id,number) VALUES(${checkoutId},${intent.id},${(prior?.number ?? 0) + 1})`,
      );
      await tx.execute(
        sql`UPDATE bookings SET status='PAYMENT_PENDING' WHERE id=${id}`,
      );
      await tx.execute(
        sql`INSERT INTO booking_events(id,booking_id,type) VALUES(${crypto.randomUUID()},${id},'PAYMENT_STARTED') ON CONFLICT DO NOTHING`,
      );
      await enqueuePaymentJob(tx, 'ORDER', checkoutId);
      await enqueuePaymentJob(tx, 'RECONCILE', checkoutId);
      return { status: 202, body: { id, checkoutId } };
    },
  );
}
