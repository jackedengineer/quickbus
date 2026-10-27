import type { Database, Transaction } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import { lockTrip } from './commands';
import {
  finishPaymentJob,
  type PaymentJob,
  requirePaymentLease,
  StalePaymentLease,
} from './payment-jobs';
import { paymentCase } from './payment-state';
import {
  type ProviderRefund,
  type RazorpayEnvironment,
  razorpay,
} from './razorpay';

type RefundRecord = {
  id: string;
  paymentId: string;
  amount: number;
  state: string;
  providerId: string | null;
  tripId: string;
  checkoutId: string;
  keyId: string;
};
async function refundRecord(db: Database | Transaction, id: string) {
  return (
    await db.execute<RefundRecord>(sql`SELECT r.id,r.payment_id AS "paymentId",r.amount,r.state,r.provider_id AS "providerId",
    b.trip_id AS "tripId",p.checkout_id AS "checkoutId",i.key_id AS "keyId"
    FROM payment_refunds r JOIN provider_payments p ON p.id=r.payment_id JOIN payment_intents i ON i.id=p.intent_id
    JOIN bookings b ON b.id=i.booking_id WHERE r.id=${id}`)
  ).rows[0];
}
export async function executeRefund(
  db: Database,
  env: RazorpayEnvironment,
  job: PaymentJob,
) {
  const api = razorpay(env),
    refund = await refundRecord(db, job.resourceId);
  if (!refund || refund.keyId !== api.keyId)
    throw new Error('Refund configuration mismatch');
  const save = async (observation: ProviderRefund | undefined) =>
    db.transaction(async (tx) => {
      await lockTrip(tx, refund.tripId);
      await requirePaymentLease(tx, job);
      const current = await refundRecord(tx, refund.id);
      if (current.state === 'PROCESSED') {
        if (!(await finishPaymentJob(tx, job))) throw new StalePaymentLease();
        return;
      }
      if (!observation) {
        await tx.execute(
          sql`UPDATE payment_refunds SET state='UNKNOWN',updated_at=clock_timestamp() WHERE id=${refund.id}`,
        );
        await paymentCase(
          tx,
          `refund:${refund.id}`,
          'REFUND_UNCERTAIN',
          refund.checkoutId,
        );
        if (!(await finishPaymentJob(tx, job, 60)))
          throw new StalePaymentLease();
        return;
      }
      const valid =
        observation.payment_id === refund.paymentId &&
        observation.amount === refund.amount &&
        observation.currency === 'INR' &&
        (!current.providerId || current.providerId === observation.id);
      if (!valid || observation.status === 'failed') {
        await tx.execute(
          sql`UPDATE payment_refunds SET state='NEEDS_REVIEW',updated_at=clock_timestamp() WHERE id=${refund.id}`,
        );
        await paymentCase(
          tx,
          `refund:${refund.id}`,
          valid ? 'REFUND_FAILED' : 'REFUND_UNCERTAIN',
          refund.checkoutId,
        );
        if (!(await finishPaymentJob(tx, job))) throw new StalePaymentLease();
        return;
      }
      await tx.execute(
        sql`UPDATE payment_refunds SET provider_id=${observation.id},state=${observation.status === 'processed' ? 'PROCESSED' : 'PROCESSING'},updated_at=clock_timestamp() WHERE id=${refund.id}`,
      );
      if (observation.status === 'processed')
        await tx.execute(
          sql`UPDATE payment_cases SET state='RESOLVED' WHERE case_key=${`refund:${refund.id}`} AND reason='REFUND_UNCERTAIN'`,
        );
      if (
        !(await finishPaymentJob(
          tx,
          job,
          observation.status === 'processed' ? undefined : 30,
        ))
      )
        throw new StalePaymentLease();
    });
  const [payment, existing] = await Promise.all([
    api.payment(refund.paymentId),
    api.refunds(refund.paymentId),
  ]);
  const exact = existing.filter(
    (r) =>
      r.payment_id === refund.paymentId &&
      r.amount === refund.amount &&
      r.currency === 'INR',
  );
  if (exact.length === 1 && existing.length === 1) {
    await save(exact[0]);
    return;
  }
  if (
    existing.length > 0 ||
    payment.id !== refund.paymentId ||
    payment.amount !== refund.amount ||
    payment.currency !== 'INR' ||
    !payment.captured ||
    !['captured', 'refunded'].includes(payment.status)
  ) {
    await db.transaction(async (tx) => {
      await lockTrip(tx, refund.tripId);
      await requirePaymentLease(tx, job);
      await tx.execute(
        sql`UPDATE payment_refunds SET state='NEEDS_REVIEW',updated_at=clock_timestamp() WHERE id=${refund.id} AND state<>'PROCESSED'`,
      );
      await paymentCase(
        tx,
        `refund:${refund.id}`,
        'REFUND_UNCERTAIN',
        refund.checkoutId,
      );
      if (!(await finishPaymentJob(tx, job))) throw new StalePaymentLease();
    });
    return;
  }
  const submit = await db.transaction(async (tx) => {
    await lockTrip(tx, refund.tripId);
    await requirePaymentLease(tx, job);
    const current = await refundRecord(tx, refund.id);
    if (current.state !== 'PENDING' || payment.amount_refunded !== 0)
      return false;
    await tx.execute(
      sql`UPDATE payment_refunds SET state='PROCESSING',started_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=${refund.id}`,
    );
    return true;
  });
  if (!submit) {
    await save(undefined);
    return;
  }
  let observed;
  try {
    observed = await api.refund(refund.paymentId, refund.amount, refund.id);
  } catch {
    await save(undefined);
    return;
  }
  await save(observed);
}
