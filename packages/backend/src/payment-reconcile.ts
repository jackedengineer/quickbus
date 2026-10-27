import type { Database } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import { lockTrip } from './commands';
import {
  finishPaymentJob,
  type PaymentJob,
  requirePaymentLease,
  StalePaymentLease,
} from './payment-jobs';
import {
  applyPaymentObservation,
  checkoutRecord,
  paymentCase,
} from './payment-state';
import { type RazorpayEnvironment, razorpay } from './razorpay';

export async function reconcileCheckout(
  db: Database,
  env: RazorpayEnvironment,
  job: PaymentJob,
) {
  const api = razorpay(env);
  let checkout = await checkoutRecord(db, job.resourceId);
  if (!checkout) throw new Error('Reconciliation resource missing');
  if (checkout.keyId !== api.keyId) throw new Error('Payment key changed');
  let orderId = checkout.orderId;
  if (!orderId && ['CREATING', 'UNKNOWN'].includes(checkout.state)) {
    const matches = await api.findOrders(checkout.id);
    await db.transaction(async (tx) => {
      await lockTrip(tx, checkout.tripId);
      await requirePaymentLease(tx, job);
      const current = await checkoutRecord(tx, checkout.id);
      if (
        matches.length === 1 &&
        matches[0].amount === checkout.amount &&
        matches[0].currency === checkout.currency &&
        (!current.orderId || current.orderId === matches[0].id)
      ) {
        orderId = matches[0].id;
        await tx.execute(
          sql`UPDATE checkout_attempts SET order_id=${orderId},state=CASE WHEN state IN ('CREATING','UNKNOWN') THEN 'READY' ELSE state END WHERE id=${checkout.id}`,
        );
        await tx.execute(
          sql`UPDATE payment_cases SET state='RESOLVED' WHERE case_key=${`order:${checkout.id}`} AND reason='ORDER_AMBIGUOUS'`,
        );
      } else {
        if (
          matches.length > 1 ||
          (checkout.startedAt &&
            Date.now() - Date.parse(checkout.startedAt) > 60000)
        )
          await paymentCase(
            tx,
            `order:${checkout.id}`,
            'ORDER_AMBIGUOUS',
            checkout.id,
          );
        if (!(await finishPaymentJob(tx, job, 30)))
          throw new StalePaymentLease();
      }
    });
    if (!orderId) return;
  }
  if (!orderId) {
    await db.transaction(async (tx) => {
      await lockTrip(tx, checkout.tripId);
      await requirePaymentLease(tx, job);
      if (
        !(await finishPaymentJob(
          tx,
          job,
          checkout.state === 'PENDING' ? 5 : undefined,
        ))
      )
        throw new StalePaymentLease();
    });
    return;
  }
  const [order, payments] = await Promise.all([
    api.order(orderId),
    api.payments(orderId),
  ]);
  await db.transaction(async (tx) => {
    await lockTrip(tx, checkout.tripId);
    await requirePaymentLease(tx, job);
    checkout = await checkoutRecord(tx, checkout.id);
    if (
      order.id !== checkout.orderId ||
      order.receipt !== checkout.id ||
      order.amount !== checkout.amount ||
      order.currency !== checkout.currency
    ) {
      await paymentCase(
        tx,
        `order-money:${checkout.id}`,
        'MONEY_MISMATCH',
        checkout.id,
      );
    } else {
      for (const payment of payments)
        await applyPaymentObservation(tx, checkout.id, payment, api.keyId);
      if (
        payments.length > 0 &&
        payments.every((p) => p.status === 'failed') &&
        order.status !== 'paid'
      )
        await tx.execute(
          sql`UPDATE checkout_attempts SET state='FAILED' WHERE id=${checkout.id} AND state='READY'`,
        );
    }
    await tx.execute(
      sql`UPDATE checkout_attempts SET last_checked_at=clock_timestamp() WHERE id=${checkout.id}`,
    );
    const settled =
      order.status === 'paid' &&
      payments.length > 0 &&
      payments.every((p) =>
        ['failed', 'captured', 'refunded'].includes(p.status),
      );
    // Continue observing earlier failed attempts for surprising later captures.
    // Settled orders need only an hourly safety read; signed events still wake
    // their own durable inbox immediately. Avoid a permanent 30-second poll.
    // At the automatic window boundary retain an actionable case, never erase it.
    const age = await tx.execute(
      sql`SELECT id FROM checkout_attempts WHERE id=${checkout.id} AND created_at<clock_timestamp()-interval '30 days'`,
    );
    if (age.rowCount) {
      if (!settled)
        await paymentCase(
          tx,
          `window:${checkout.id}`,
          'RETRY_EXHAUSTED',
          checkout.id,
        );
      if (!(await finishPaymentJob(tx, job))) throw new StalePaymentLease();
    } else if (!(await finishPaymentJob(tx, job, settled ? 3600 : 30)))
      throw new StalePaymentLease();
  });
}
