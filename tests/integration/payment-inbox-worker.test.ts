import { createHmac, randomUUID } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { receivePaymentWebhook } from '../../packages/backend/src/payment-inbox';
import { processPaymentInbox } from '../../packages/backend/src/payment-inbox-worker';
import { claimPaymentJob } from '../../packages/backend/src/payment-jobs';
import { ProviderUnavailable } from '../../packages/backend/src/razorpay';
import { paymentFixture } from '../support/payments';

afterEach(() => vi.unstubAllGlobals());

const foreignOrder = {
  id: 'order_foreign',
  receipt: null,
  amount: 50000,
  currency: 'INR',
  status: 'paid',
  amount_paid: 50000,
  amount_due: 0,
  attempts: 1,
};
const foreignPayment = {
  id: 'pay_foreign',
  order_id: 'order_foreign',
  amount: 50000,
  currency: 'INR',
  status: 'captured',
  captured: true,
  amount_refunded: 0,
};
// A captured payment made outside this app, as Razorpay actually returned it.
const asOwnRecords = (url: string) =>
  Response.json(url.includes('/payments/') ? foreignPayment : foreignOrder);
// Same payment, but above the amount range this app accepts.
const outOfContract = () =>
  Response.json({ ...foreignPayment, amount: 900000000 });
const rejectedId = () =>
  Response.json({ error: { code: 'BAD_REQUEST_ERROR' } }, { status: 400 });
const outage = () => new Response(null, { status: 503 });

async function deliver(
  f: Awaited<ReturnType<typeof paymentFixture>>,
  env: {
    RAZORPAY_WEBHOOK_SECRET: string;
    RAZORPAY_KEY_ID: string;
    RAZORPAY_KEY_SECRET: string;
  },
  entity: { id: string; order_id: string },
) {
  const raw = Buffer.from(
    JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity } },
    }),
  );
  const received = await receivePaymentWebhook(
    f.runtime.db,
    env,
    raw,
    randomUUID(),
    createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex'),
  );
  expect(received.status).toBe(200);
  const inboxId = String(received.body.jobResourceId);
  // Claim this event's job only: other suites may leave work in a shared queue.
  const job = await claimPaymentJob(f.runtime.db, inboxId);
  if (!job) throw new Error('Missing inbox job');
  return { inboxId, job };
}

test.each([
  ['a null order receipt', asOwnRecords],
  ['a record outside the accepted contract', outOfContract],
  ['an ID the provider rejects', rejectedId],
])(
  'a foreign payment with %s is ignored without a case or retries',
  async (_, respond) => {
    const f = await paymentFixture();
    const env = {
      RAZORPAY_KEY_ID: f.keyId,
      RAZORPAY_KEY_SECRET: 'synthetic-provider-secret',
      RAZORPAY_WEBHOOK_SECRET: 'synthetic-webhook-secret',
    };
    let inboxId = '';
    try {
      const delivered = await deliver(f, env, {
        id: `pay_${randomUUID().replaceAll('-', '')}`,
        order_id: `order_${randomUUID().replaceAll('-', '')}`,
      });
      inboxId = delivered.inboxId;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => respond(url)),
      );
      await processPaymentInbox(f.runtime.db, env, delivered.job);
      const state = (
        await f.owner.query(
          `SELECT i.processed_at IS NOT NULL AS processed,j.state,
           (SELECT count(*)::int FROM payment_cases WHERE case_key=$2 OR case_key=$3) AS cases
         FROM payment_inbox i JOIN payment_jobs j ON j.resource_id=i.id WHERE i.id=$1`,
          [inboxId, `inbox:${inboxId}`, `job:${delivered.job.id}`],
        )
      ).rows[0];
      expect(state).toEqual({ processed: true, state: 'DONE', cases: 0 });
    } finally {
      await f.owner.query('DELETE FROM payment_jobs WHERE resource_id=$1', [
        inboxId,
      ]);
      await f.owner.query('DELETE FROM payment_inbox WHERE id=$1', [inboxId]);
      await f.close();
    }
  },
);

test.each([
  ['an unusable record for our own order', outOfContract, true],
  ['a provider outage, even for an unknown order', outage, false],
])('%s still fails so it can retry', async (_, respond, own) => {
  const f = await paymentFixture();
  const env = {
    RAZORPAY_KEY_ID: f.keyId,
    RAZORPAY_KEY_SECRET: 'synthetic-provider-secret',
    RAZORPAY_WEBHOOK_SECRET: 'synthetic-webhook-secret',
  };
  let inboxId = '';
  try {
    const delivered = await deliver(f, env, {
      id: `pay_${randomUUID().replaceAll('-', '')}`,
      order_id: own
        ? f.payment.order_id
        : `order_${randomUUID().replaceAll('-', '')}`,
    });
    inboxId = delivered.inboxId;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond()),
    );
    await expect(
      processPaymentInbox(f.runtime.db, env, delivered.job),
    ).rejects.toBeInstanceOf(ProviderUnavailable);
    const inbox = await f.owner.query(
      'SELECT processed_at FROM payment_inbox WHERE id=$1',
      [inboxId],
    );
    expect(inbox.rows[0].processed_at).toBeNull();
  } finally {
    await f.owner.query('DELETE FROM payment_jobs WHERE resource_id=$1', [
      inboxId,
    ]);
    await f.owner.query('DELETE FROM payment_inbox WHERE id=$1', [inboxId]);
    await f.close();
  }
});

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
