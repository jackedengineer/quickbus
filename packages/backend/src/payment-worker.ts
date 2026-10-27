import type { Database } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import {
  claimPaymentJob,
  failPaymentJob,
  StalePaymentLease,
} from './payment-jobs';
import { createCheckoutOrder } from './payment-orders';
import { reconcileCheckout } from './payment-reconcile';
import { executeRefund } from './payment-refunds';
import { paymentCase } from './payment-state';
import { ProviderUnavailable, type RazorpayEnvironment } from './razorpay';

export async function runPaymentJobs(
  db: Database,
  env: RazorpayEnvironment,
  limit = 6,
) {
  // Disabling new checkout does not disable recovery of existing money exposure.
  if (!env.RAZORPAY_KEY_ID) return 0;
  let processed = 0;
  for (let n = 0; n < limit; n++) {
    const job = await claimPaymentJob(db);
    if (!job) break;
    try {
      if (job.kind === 'ORDER') await createCheckoutOrder(db, env, job);
      else if (job.kind === 'RECONCILE') await reconcileCheckout(db, env, job);
      else if (job.kind === 'REFUND') await executeRefund(db, env, job);
      else throw new Error('Inbox processor not yet enabled');
      processed++;
    } catch (error) {
      if (error instanceof StalePaymentLease) continue;
      await failPaymentJob(
        db,
        job,
        error instanceof ProviderUnavailable
          ? 'PROVIDER_UNAVAILABLE'
          : 'PROCESSING_FAILED',
      );
      if (job.attempts >= 8)
        await db.transaction((tx) =>
          paymentCase(tx, `job:${job.id}`, 'RETRY_EXHAUSTED'),
        );
    }
  }
  // A repeatedly killed worker can reach the claim cap without executing catch.
  await db.execute(sql`UPDATE payment_jobs SET state='FAILED',failure_code='RETRY_EXHAUSTED',lease_token=NULL,lease_expires_at=NULL
    WHERE state='RUNNING' AND attempts>=32 AND lease_expires_at<=clock_timestamp()`);
  return processed;
}
