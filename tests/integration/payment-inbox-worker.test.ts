import { createHmac, randomUUID } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { receivePaymentWebhook } from '../../packages/backend/src/payment-inbox';
import { processPaymentInbox } from '../../packages/backend/src/payment-inbox-worker';
import { claimPaymentJob } from '../../packages/backend/src/payment-jobs';
import { paymentFixture } from '../support/payments';

afterEach(() => vi.unstubAllGlobals());
test('different signed event identities for one capture finalize and acknowledge once each', async () => {
  const f = await paymentFixture(),
    events = [randomUUID(), randomUUID()],
    secret = 'synthetic-webhook-secret';
  const env = {
    RAZORPAY_KEY_ID: f.keyId,
    RAZORPAY_KEY_SECRET: 'synthetic-provider-secret',
    RAZORPAY_WEBHOOK_SECRET: secret,
  };
  try {
    const raw = Buffer.from(
      JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: { id: f.payment.id, order_id: f.payment.order_id },
          },
        },
      }),
    );
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    for (const event of events)
      expect(
        (await receivePaymentWebhook(f.runtime.db, env, raw, event, signature))
          .status,
      ).toBe(200);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json(
          url.includes('/payments/')
            ? f.payment
            : {
                id: f.payment.order_id,
                receipt: f.checkout,
                amount: 74900,
                currency: 'INR',
                status: 'paid',
                amount_paid: 74900,
                amount_due: 0,
                attempts: 1,
              },
        ),
      ),
    );
    for (let n = 0; n < 2; n++) {
      const job = await claimPaymentJob(f.runtime.db);
      if (!job) throw new Error('Missing inbox job');
      await processPaymentInbox(f.runtime.db, env, job);
    }
    expect(
      (
        await f.owner.query(
          "SELECT count(*)::int n FROM booking_events WHERE booking_id=$1 AND type='CONFIRMED'",
          [f.booking],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM payment_inbox WHERE event_id=ANY($1::text[]) AND processed_at IS NOT NULL',
          [events],
        )
      ).rows[0].n,
    ).toBe(2);
  } finally {
    await f.owner.query(
      'DELETE FROM payment_jobs WHERE resource_id IN(SELECT id FROM payment_inbox WHERE event_id=ANY($1::text[]))',
      [events],
    );
    await f.owner.query(
      'DELETE FROM payment_inbox WHERE event_id=ANY($1::text[])',
      [events],
    );
    await f.close();
  }
});
