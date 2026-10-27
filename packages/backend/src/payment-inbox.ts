import { createHash } from 'node:crypto';
import type { Database } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import { z } from 'zod';
import { failure } from './commands';
import { enqueuePaymentJob } from './payment-jobs';
import { paymentCase } from './payment-state';
import { type RazorpayEnvironment, verifySignature } from './razorpay';

const id = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{1,40}$`));
const eventSchema = z.object({
  event: z.enum([
    'payment.authorized',
    'payment.failed',
    'payment.captured',
    'refund.created',
    'refund.processed',
    'refund.failed',
  ]),
  payload: z.object({
    payment: z
      .object({
        entity: z.object({ id: id('pay'), order_id: id('order').nullable() }),
      })
      .optional(),
    refund: z
      .object({ entity: z.object({ id: id('rfnd'), payment_id: id('pay') }) })
      .optional(),
  }),
});
export async function receivePaymentWebhook(
  db: Database,
  env: RazorpayEnvironment,
  raw: Uint8Array,
  eventId: string,
  signature: string,
) {
  if (!env.RAZORPAY_WEBHOOK_SECRET)
    return failure(
      'WEBHOOK_UNAVAILABLE',
      'Webhook configuration unavailable.',
      503,
    );
  if (!verifySignature(env.RAZORPAY_WEBHOOK_SECRET, raw, signature))
    return failure('INVALID_SIGNATURE', 'Invalid webhook signature.', 401);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(eventId))
    return failure('INVALID_EVENT', 'Missing event identity.', 400);
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw).toString('utf8'));
  } catch {
    return failure('INVALID_EVENT', 'Invalid webhook JSON.', 400);
  }
  const input = eventSchema.safeParse(decoded);
  if (!input.success)
    return failure('INVALID_EVENT', 'Unsupported webhook.', 400);
  const { event, payload } = input.data;
  if (event.startsWith('payment.') ? !payload.payment : !payload.refund)
    return failure('INVALID_EVENT', 'Missing event entity.', 400);
  const hash = createHash('sha256').update(raw).digest('hex');
  return db.transaction(async (tx) => {
    const localId = crypto.randomUUID();
    const inserted =
      await tx.execute(sql`INSERT INTO payment_inbox(id,event_id,event_type,payload_hash,order_id,payment_id,refund_id)
      VALUES(${localId},${eventId},${event},${hash},${payload.payment?.entity.order_id ?? null},${payload.payment?.entity.id ?? payload.refund?.entity.payment_id ?? null},${payload.refund?.entity.id ?? null})
      ON CONFLICT(event_id) DO NOTHING RETURNING id`);
    if (!inserted.rowCount) {
      const prior = (
        await tx.execute<{ hash: string }>(
          sql`SELECT payload_hash AS hash FROM payment_inbox WHERE event_id=${eventId}`,
        )
      ).rows[0];
      if (prior.hash !== hash) {
        await paymentCase(tx, `event:${eventId}`, 'EVENT_HASH_MISMATCH');
        return failure('EVENT_HASH_MISMATCH', 'Event identity changed.', 409);
      }
    } else await enqueuePaymentJob(tx, 'INBOX', localId);
    // ACK only after this transaction commits. Store no raw webhook/contact data.
    return { status: 200, body: { received: true } };
  });
}
