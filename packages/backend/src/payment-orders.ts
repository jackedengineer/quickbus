import type { Database } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import { lockTrip } from './commands';
import {
  finishPaymentJob,
  type PaymentJob,
  requirePaymentLease,
  StalePaymentLease,
} from './payment-jobs';
import { checkoutRecord, paymentCase } from './payment-state';
import { type RazorpayEnvironment, razorpay } from './razorpay';

export async function createCheckoutOrder(
  db: Database,
  env: RazorpayEnvironment,
  job: PaymentJob,
) {
  const provider = razorpay(env);
  const initial = await checkoutRecord(db, job.resourceId);
  if (!initial) throw new Error('Checkout job resource missing');
  const create = await db.transaction(async (tx) => {
    const trip = await lockTrip(tx, initial.tripId);
    await requirePaymentLease(tx, job);
    const current = await checkoutRecord(tx, initial.id);
    if (current.keyId !== provider.keyId)
      throw new Error('Payment key changed');
    if (current.state !== 'PENDING') {
      if (current.state === 'CREATING')
        await tx.execute(
          sql`UPDATE checkout_attempts SET state='UNKNOWN' WHERE id=${current.id}`,
        );
      if (!(await finishPaymentJob(tx, job))) throw new StalePaymentLease();
      return false;
    }
    const eligible =
      await tx.execute(sql`SELECT id FROM bookings WHERE id=${current.bookingId} AND status='PAYMENT_PENDING'
      AND expires_at>=${trip?.timestamp}::timestamptz+interval '90 seconds'`);
    if (!trip || trip.sales_state === 'CANCELLED' || !eligible.rowCount) {
      await tx.execute(
        sql`UPDATE checkout_attempts SET state='CLOSED' WHERE id=${current.id}`,
      );
      if (!(await finishPaymentJob(tx, job))) throw new StalePaymentLease();
      return false;
    }
    await tx.execute(
      sql`UPDATE checkout_attempts SET state='CREATING',started_at=clock_timestamp() WHERE id=${current.id}`,
    );
    return true;
  });
  if (!create) return;
  // CREATING is durably committed before the only order-create call.
  // A lease replacement will reconcile this receipt; it will never POST again.
  let order;
  try {
    order = await provider.createOrder(initial.id, initial.amount);
  } catch {
    await db.transaction(async (tx) => {
      await lockTrip(tx, initial.tripId);
      await requirePaymentLease(tx, job);
      await tx.execute(
        sql`UPDATE checkout_attempts SET state='UNKNOWN' WHERE id=${initial.id} AND order_id IS NULL AND state='CREATING'`,
      );
      if (!(await finishPaymentJob(tx, job))) throw new StalePaymentLease();
    });
    return;
  }
  await db.transaction(async (tx) => {
    await lockTrip(tx, initial.tripId);
    await requirePaymentLease(tx, job);
    const current = await checkoutRecord(tx, initial.id);
    if (
      order.receipt !== initial.id ||
      order.amount !== initial.amount ||
      order.currency !== initial.currency ||
      (current.orderId && current.orderId !== order.id)
    ) {
      await paymentCase(
        tx,
        `order:${initial.id}`,
        'ORDER_AMBIGUOUS',
        initial.id,
      );
      await tx.execute(
        sql`UPDATE checkout_attempts SET state='UNKNOWN' WHERE id=${initial.id} AND order_id IS NULL`,
      );
    } else {
      await tx.execute(
        sql`UPDATE checkout_attempts SET order_id=${order.id},state=CASE WHEN state IN ('CREATING','UNKNOWN') THEN 'READY' ELSE state END WHERE id=${initial.id}`,
      );
    }
    if (!(await finishPaymentJob(tx, job))) throw new StalePaymentLease();
  });
}
