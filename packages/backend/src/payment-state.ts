import type { Database, Transaction } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import { lockTrip } from './commands';
import { enqueueBookingNotification } from './notification-queue';
import { enqueuePaymentJob } from './payment-jobs';
import type { ProviderPayment } from './razorpay';

export type CheckoutRecord = {
  id: string;
  intentId: string;
  bookingId: string;
  tripId: string;
  amount: number;
  currency: string;
  keyId: string;
  state: string;
  orderId: string | null;
  startedAt: string | null;
  createdAt: string;
  number: number;
};
export async function checkoutRecord(db: Database | Transaction, id: string) {
  return (
    await db.execute<CheckoutRecord>(sql`SELECT c.id,c.intent_id AS "intentId",i.booking_id AS "bookingId",b.trip_id AS "tripId",
    i.amount,i.currency,i.key_id AS "keyId",c.state,c.order_id AS "orderId",c.started_at::text AS "startedAt",c.created_at::text AS "createdAt",c.number
    FROM checkout_attempts c JOIN payment_intents i ON i.id=c.intent_id JOIN bookings b ON b.id=i.booking_id WHERE c.id=${id}`)
  ).rows[0];
}
export async function paymentCase(
  tx: Transaction,
  key: string,
  reason: string,
  checkoutId: string | null = null,
) {
  await tx.execute(
    sql`INSERT INTO payment_cases(id,case_key,reason,checkout_id) VALUES(${crypto.randomUUID()},${key},${reason},${checkoutId}) ON CONFLICT(case_key) DO NOTHING`,
  );
}
export async function ensureRefund(
  tx: Transaction,
  paymentId: string,
  amount: number,
) {
  await tx.execute(
    sql`INSERT INTO payment_refunds(id,payment_id,amount) VALUES(${crypto.randomUUID()},${paymentId},${amount}) ON CONFLICT(payment_id) DO NOTHING`,
  );
  const refund = (
    await tx.execute<{ id: string }>(
      sql`SELECT id FROM payment_refunds WHERE payment_id=${paymentId}`,
    )
  ).rows[0];
  await enqueuePaymentJob(tx, 'REFUND', refund.id);
}

// All authoritative provider fetches converge here. The caller commits job/inbox
// completion with this transition, and performs every network request beforehand.
export async function applyPaymentObservation(
  tx: Transaction,
  checkoutId: string,
  payment: ProviderPayment,
  keyId: string,
) {
  const initial = await checkoutRecord(tx, checkoutId);
  if (!initial) return;
  const trip = await lockTrip(tx, initial.tripId);
  const checkout = await checkoutRecord(tx, checkoutId);
  if (!checkout || !trip) throw new Error('Payment booking unavailable');
  const prior = (
    await tx.execute<{
      checkoutId: string;
      intentId: string;
      state: string;
      disposition: string;
      amount: number;
      currency: string;
    }>(sql`
    SELECT checkout_id AS "checkoutId",intent_id AS "intentId",state,disposition,amount,currency FROM provider_payments WHERE id=${payment.id}`)
  ).rows[0];
  if (
    checkout.keyId !== keyId ||
    checkout.orderId !== payment.order_id ||
    (prior &&
      (prior.checkoutId !== checkout.id ||
        prior.intentId !== checkout.intentId ||
        prior.amount !== payment.amount ||
        prior.currency !== payment.currency))
  ) {
    await paymentCase(
      tx,
      `mapping:${payment.id}`,
      'MONEY_MISMATCH',
      checkout.id,
    );
    return;
  }
  if (
    prior &&
    ['captured', 'refunded'].includes(prior.state) &&
    !['captured', 'refunded'].includes(payment.status)
  )
    return;
  if (prior?.state === 'refunded' && payment.status === 'captured') return;
  await tx.execute(sql`INSERT INTO provider_payments(id,checkout_id,intent_id,amount,currency,state)
    VALUES(${payment.id},${checkout.id},${checkout.intentId},${payment.amount},${payment.currency},${payment.status})
    ON CONFLICT(id) DO UPDATE SET state=excluded.state,updated_at=clock_timestamp()`);
  if (!['captured', 'refunded'].includes(payment.status)) return;
  if (
    !payment.captured ||
    payment.amount !== checkout.amount ||
    payment.currency !== checkout.currency
  ) {
    await tx.execute(
      sql`UPDATE provider_payments SET disposition='REVIEW' WHERE id=${payment.id} AND disposition<>'FULFILLED'`,
    );
    await paymentCase(tx, `money:${payment.id}`, 'MONEY_MISMATCH', checkout.id);
    return;
  }
  // The newest attempt may still be READY when an older attempt captures.
  // It remains tracked and any later capture is compensated, never fulfilled twice.
  await tx.execute(
    sql`UPDATE checkout_attempts SET state='CAPTURED' WHERE id=${checkout.id}`,
  );
  if (prior?.disposition === 'FULFILLED') {
    // Repair an outbox gap if an older Worker confirmed during an additive rollout.
    await enqueueBookingNotification(tx, checkout.bookingId, 'CONFIRMED');
    // An operator-side refund is outside customer cancellation in this slice.
    // Preserve inventory and surface the financial inconsistency for review.
    if (payment.status === 'refunded' || payment.amount_refunded > 0)
      await paymentCase(
        tx,
        `fulfilled-refund:${payment.id}`,
        'MONEY_MISMATCH',
        checkout.id,
      );
    return;
  }
  if (prior?.disposition === 'REFUND') {
    await ensureRefund(tx, payment.id, payment.amount);
    return;
  }
  const booking = (
    await tx.execute<{ status: string; eligible: boolean; owned: boolean }>(sql`
    SELECT b.status,b.expires_at>${trip.timestamp}::timestamptz AS eligible,
      EXISTS(SELECT 1 FROM booking_items WHERE booking_id=b.id) AND NOT EXISTS(
        SELECT 1 FROM booking_items i WHERE i.booking_id=b.id AND NOT EXISTS(
          SELECT 1 FROM seat_allocations a WHERE a.booking_id=i.booking_id AND a.trip_id=i.trip_id AND a.seat_label=i.seat_label)) AS owned
    FROM bookings b WHERE id=${checkout.bookingId}`)
  ).rows[0];
  const alreadyFulfilled = await tx.execute(
    sql`SELECT id FROM provider_payments WHERE intent_id=${checkout.intentId} AND disposition='FULFILLED' LIMIT 1`,
  );
  if (
    payment.status === 'captured' &&
    payment.amount_refunded === 0 &&
    booking.status === 'PAYMENT_PENDING' &&
    booking.eligible &&
    booking.owned &&
    trip.sales_state !== 'CANCELLED' &&
    !alreadyFulfilled.rowCount
  ) {
    await tx.execute(
      sql`UPDATE provider_payments SET disposition='FULFILLED' WHERE id=${payment.id}`,
    );
    await tx.execute(
      sql`UPDATE bookings SET status='CONFIRMED' WHERE id=${checkout.bookingId}`,
    );
    await tx.execute(
      sql`INSERT INTO booking_events(id,booking_id,type) VALUES(${crypto.randomUUID()},${checkout.bookingId},'CONFIRMED') ON CONFLICT DO NOTHING`,
    );
    await enqueueBookingNotification(tx, checkout.bookingId, 'CONFIRMED');
  } else {
    if (
      booking.status === 'PAYMENT_PENDING' &&
      (trip.sales_state === 'CANCELLED' ||
        !booking.owned ||
        payment.status === 'refunded' ||
        payment.amount_refunded > 0)
    ) {
      await tx.execute(
        sql`UPDATE bookings SET status='CANCELLED' WHERE id=${checkout.bookingId}`,
      );
      await tx.execute(
        sql`DELETE FROM seat_allocations WHERE booking_id=${checkout.bookingId}`,
      );
      await tx.execute(
        sql`INSERT INTO booking_events(id,booking_id,type) VALUES(${crypto.randomUUID()},${checkout.bookingId},'CANCELLED') ON CONFLICT DO NOTHING`,
      );
    }
    await tx.execute(
      sql`UPDATE provider_payments SET disposition='REFUND' WHERE id=${payment.id}`,
    );
    await ensureRefund(tx, payment.id, payment.amount);
    if (booking.status === 'PAYMENT_PENDING' && !booking.owned)
      await paymentCase(
        tx,
        `allocation:${checkout.id}`,
        'ALLOCATION_MISMATCH',
        checkout.id,
      );
  }
}
