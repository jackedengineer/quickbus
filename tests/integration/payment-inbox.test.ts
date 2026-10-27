import { createHmac, randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { receivePaymentWebhook } from '../../packages/backend/src/payment-inbox';
import { createDatabase } from '../../packages/db/src/client';
import { fixtureClient } from '../support/fixtures';

test('webhook intake verifies exact bytes and commits one inbox/job before ACK', async () => {
  const owner = await fixtureClient(),
    runtime = createDatabase(
      process.env.DATABASE_URL ?? '',
      process.env.CI_DATABASE_PROXY,
    );
  const eventId = `evt_${randomUUID().replaceAll('-', '')}`,
    secret = 'synthetic-webhook-signing-secret';
  const raw = Buffer.from(
    JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_fixture',
            order_id: 'order_fixture',
            email: 'discarded@example.test',
          },
        },
      },
    }),
  );
  const sign = (bytes: Uint8Array) =>
    createHmac('sha256', secret).update(bytes).digest('hex');
  try {
    expect(
      (
        await receivePaymentWebhook(
          runtime.db,
          { RAZORPAY_WEBHOOK_SECRET: secret },
          Buffer.concat([raw, Buffer.from(' ')]),
          eventId,
          sign(raw),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await owner.query('SELECT id FROM payment_inbox WHERE event_id=$1', [
          eventId,
        ])
      ).rowCount,
    ).toBe(0);
    const first = await receivePaymentWebhook(
      runtime.db,
      { RAZORPAY_WEBHOOK_SECRET: secret },
      raw,
      eventId,
      sign(raw),
    );
    expect(first.status).toBe(200);
    expect(
      await receivePaymentWebhook(
        runtime.db,
        { RAZORPAY_WEBHOOK_SECRET: secret },
        raw,
        eventId,
        sign(raw),
      ),
    ).toEqual(first);
    const changed = Buffer.concat([raw, Buffer.from('\n')]);
    expect(
      (
        await receivePaymentWebhook(
          runtime.db,
          { RAZORPAY_WEBHOOK_SECRET: secret },
          changed,
          eventId,
          sign(changed),
        )
      ).status,
    ).toBe(409);
    const rows = await owner.query(
      `SELECT i.*, (SELECT count(*)::int FROM payment_jobs WHERE resource_id=i.id) jobs FROM payment_inbox i WHERE event_id=$1`,
      [eventId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].jobs).toBe(1);
    expect(JSON.stringify(rows.rows[0])).not.toContain(
      'discarded@example.test',
    );
  } finally {
    await owner.query(
      'DELETE FROM payment_jobs WHERE resource_id IN(SELECT id FROM payment_inbox WHERE event_id=$1)',
      [eventId],
    );
    await owner.query('DELETE FROM payment_inbox WHERE event_id=$1', [eventId]);
    await owner.query('DELETE FROM payment_cases WHERE case_key=$1', [
      `event:${eventId}`,
    ]);
    await runtime.close();
    await owner.end();
  }
});
