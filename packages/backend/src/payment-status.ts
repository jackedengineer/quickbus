import type { Database } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import { failure } from './commands';
import { checkoutRecord } from './payment-state';
import { type RazorpayEnvironment, verifySignature } from './razorpay';

export async function paymentStatus(
  db: Database,
  env: RazorpayEnvironment,
  userId: string,
  id: string,
) {
  const row = (
    await db.execute<{
      id: string;
      status: string;
      eligible: boolean;
      checkout: {
        id: string;
        state: string;
        orderId: string | null;
        keyId: string;
        amount: number;
        currency: string;
        unresolved: boolean;
      } | null;
      refunds: string[];
      needsReview: boolean;
    }>(sql`
    SELECT b.id,
      CASE WHEN b.status IN ('HELD','PAYMENT_PENDING') AND b.expires_at<=statement_timestamp() THEN 'EXPIRED' ELSE b.status END status,
      b.expires_at>=statement_timestamp()+interval '90 seconds' AND b.status IN ('HELD','PAYMENT_PENDING') AS eligible,
      (SELECT jsonb_build_object('id',c.id,'state',c.state,'orderId',c.order_id,'keyId',i.key_id,'amount',i.amount,'currency',i.currency,
        'unresolved',EXISTS(SELECT 1 FROM provider_payments p WHERE p.checkout_id=c.id AND p.state IN ('created','authorized')))
       FROM checkout_attempts c JOIN payment_intents i ON i.id=c.intent_id WHERE i.booking_id=b.id ORDER BY c.number DESC LIMIT 1) checkout,
      ARRAY(SELECT r.state FROM payment_refunds r JOIN provider_payments p ON p.id=r.payment_id JOIN payment_intents i ON i.id=p.intent_id WHERE i.booking_id=b.id) refunds,
      EXISTS(SELECT 1 FROM payment_cases pc JOIN checkout_attempts c ON c.id=pc.checkout_id JOIN payment_intents i ON i.id=c.intent_id WHERE i.booking_id=b.id AND pc.state='OPEN') AS "needsReview"
    FROM bookings b WHERE b.id=${id} AND b.user_id=${userId}`)
  ).rows[0];
  if (!row) return null;
  const enabled = env.PAYMENTS_ENABLED === 'true',
    c = row.checkout;
  const canOpen = Boolean(
    enabled &&
      row.eligible &&
      c?.state === 'READY' &&
      c.orderId &&
      c.keyId === env.RAZORPAY_KEY_ID &&
      !c.unresolved,
  );
  return {
    id: row.id,
    status: row.status,
    enabled,
    mode: 'test' as const,
    canStart: Boolean(enabled && row.eligible && (!c || c.state === 'FAILED')),
    needsReview: row.needsReview,
    refunds: row.refunds,
    checkout: c
      ? {
          id: c.id,
          state: c.state,
          canOpen,
          ...(canOpen
            ? {
                keyId: c.keyId,
                orderId: c.orderId,
                amount: c.amount,
                currency: c.currency,
              }
            : {}),
        }
      : null,
  };
}

export async function paymentHint(
  db: Database,
  env: RazorpayEnvironment,
  userId: string,
  bookingId: string,
  checkoutId: string,
  verification?: { paymentId: string; signature: string },
) {
  const checkout = await checkoutRecord(db, checkoutId);
  const owned = await db.execute(
    sql`SELECT id FROM bookings WHERE id=${bookingId} AND user_id=${userId}`,
  );
  if (!checkout || !owned.rowCount || checkout.bookingId !== bookingId)
    return failure('BOOKING_NOT_FOUND', 'Reservation not found.', 404);
  if (checkout.keyId !== env.RAZORPAY_KEY_ID)
    return failure(
      'PAYMENT_CONFIGURATION_CHANGED',
      'Payment recovery needs review.',
      503,
    );
  if (
    verification &&
    (!checkout.orderId ||
      !env.RAZORPAY_KEY_SECRET ||
      !verifySignature(
        env.RAZORPAY_KEY_SECRET,
        `${checkout.orderId}|${verification.paymentId}`,
        verification.signature,
      ))
  )
    return failure('INVALID_SIGNATURE', 'Payment verification failed.', 401);
  // This is only a read-reconciliation hint. No browser fields can change money,
  // booking state or inventory. Coalesce repeated clicks/callback replays.
  await db.execute(sql`UPDATE payment_jobs SET state='QUEUED',attempts=0,available_at=clock_timestamp(),updated_at=clock_timestamp(),failure_code=NULL
    WHERE kind='RECONCILE' AND resource_id=${checkout.id} AND state IN ('QUEUED','DONE') AND updated_at<clock_timestamp()-interval '5 seconds'`);
  return { status: 202, body: { received: true, checkoutId } };
}
