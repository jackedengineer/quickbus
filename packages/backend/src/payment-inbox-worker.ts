import type { Database } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import { z } from 'zod';
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
import {
  type ProviderOrder,
  type ProviderPayment,
  ProviderUnavailable,
  type RazorpayEnvironment,
  razorpay,
} from './razorpay';

// The provider answered, and the answer can't be used: an out-of-contract record,
// or an ID it rejects. Timeouts and 5xx/429/401 remain retryable outages.
function unusableRecord(error: unknown) {
  return (
    error instanceof ProviderUnavailable &&
    (error.phase === 'shape' ||
      (error.phase === 'http' &&
        (error.httpStatus === 400 || error.httpStatus === 404)))
  );
}

async function referencedLocally(
  db: Database,
  inbox: { orderId: string | null; paymentId: string | null },
) {
  const result = await db.execute<{ known: boolean }>(sql`SELECT
    EXISTS(SELECT 1 FROM checkout_attempts WHERE order_id=${inbox.orderId})
    OR EXISTS(SELECT 1 FROM provider_payments WHERE id=${inbox.paymentId}) AS known`);
  return result.rows[0].known;
}

export async function processPaymentInbox(
  db: Database,
  env: RazorpayEnvironment,
  job: PaymentJob,
) {
  const inbox = (
    await db.execute<{
      id: string;
      orderId: string | null;
      paymentId: string | null;
      processedAt: string | null;
    }>(
      sql`SELECT id,order_id AS "orderId",payment_id AS "paymentId",processed_at AS "processedAt" FROM payment_inbox WHERE id=${job.resourceId}`,
    )
  ).rows[0];
  if (!inbox) throw new Error('Webhook resource missing');
  const api = razorpay(env);
  let payment: ProviderPayment | null = null;
  let order: ProviderOrder | null = null;
  try {
    payment = inbox.paymentId ? await api.payment(inbox.paymentId) : null;
    // Resolve by a fetched order's exact local receipt even if the create response
    // has not been saved yet. The signing secret alone cannot fulfill anything.
    order = payment ? await api.order(payment.order_id) : null;
  } catch (error) {
    // The Razorpay account can carry payments from outside this app, and those
    // need not fit our schemas. Retrying can never help, and exhausting the job
    // would hold health red over money that isn't ours. Only ignore records we
    // have no local reference to: a missed event for one of our own checkouts
    // keeps failing visibly here, and its RECONCILE job still recovers it.
    if (!unusableRecord(error) || (await referencedLocally(db, inbox)))
      throw error;
    payment = null;
    order = null;
    console.log(JSON.stringify({ event: 'payment_inbox_foreign_ignored' }));
  }
  const receipt = z.uuid().safeParse(order?.receipt);
  const checkout = receipt.success
    ? await checkoutRecord(db, receipt.data)
    : undefined;
  await db.transaction(async (tx) => {
    if (checkout) await lockTrip(tx, checkout.tripId);
    await requirePaymentLease(tx, job);
    if (
      payment &&
      payment.id === inbox.paymentId &&
      order &&
      checkout &&
      checkout.keyId === api.keyId &&
      order.id === payment.order_id &&
      order.amount === checkout.amount &&
      order.currency === checkout.currency
    ) {
      const current = await checkoutRecord(tx, checkout.id);
      if (!current.orderId) {
        await tx.execute(
          sql`UPDATE checkout_attempts SET order_id=${order.id},state='READY' WHERE id=${checkout.id} AND state IN ('CREATING','UNKNOWN')`,
        );
      }
      await applyPaymentObservation(tx, checkout.id, payment, api.keyId);
      await tx.execute(
        sql`UPDATE payment_jobs SET available_at=clock_timestamp() WHERE kind='REFUND' AND state='QUEUED' AND resource_id IN(SELECT id FROM payment_refunds WHERE payment_id=${payment.id})`,
      );
    } else if (
      checkout ||
      (order?.notes.kwikbus_app === 'kwikbus' &&
        order.notes.kwikbus_environment ===
          (env.DEPLOYMENT_ENV === 'production' ? 'production' : 'development'))
    )
      await paymentCase(
        tx,
        `inbox:${inbox.id}`,
        'UNMAPPED_EVENT',
        checkout?.id ?? null,
      );
    await tx.execute(
      sql`UPDATE payment_inbox SET processed_at=clock_timestamp() WHERE id=${inbox.id}`,
    );
    if (!(await finishPaymentJob(tx, job))) throw new StalePaymentLease();
  });
}
