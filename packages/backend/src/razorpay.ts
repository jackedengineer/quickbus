import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const money = z.number().int().nonnegative().max(10000000);
const providerId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{1,40}$`));
const orderSchema = z.object({
  id: providerId('order'),
  receipt: z.string().max(40),
  amount: money,
  currency: z.string().length(3),
  status: z.enum(['created', 'attempted', 'paid']),
  // The list endpoint returns null before any payment in the tested account.
  amount_paid: money.nullable(),
  amount_due: money,
  attempts: z.number().int().nonnegative(),
});
const paymentSchema = z.object({
  id: providerId('pay'),
  order_id: providerId('order'),
  amount: money,
  currency: z.string().length(3),
  status: z.enum(['created', 'authorized', 'captured', 'refunded', 'failed']),
  captured: z.boolean(),
  amount_refunded: money,
});
const refundSchema = z.object({
  id: providerId('rfnd'),
  payment_id: providerId('pay'),
  amount: money,
  currency: z.string().length(3),
  status: z.enum(['pending', 'processed', 'failed']),
});
export type ProviderOrder = z.infer<typeof orderSchema>;
export type ProviderPayment = z.infer<typeof paymentSchema>;
export type ProviderRefund = z.infer<typeof refundSchema>;
export type RazorpayEnvironment = {
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  PAYMENTS_ENABLED?: string;
};

// No response bodies, request URLs, credentials or provider descriptions in errors.
// Every failed POST is ambiguous unless a validated response establishes success.
export class ProviderUnavailable extends Error {
  constructor(readonly httpStatus?: number) {
    super('Payment provider unavailable. Reconcile before another mutation.');
  }
}

export function verifySignature(
  secret: string,
  bytes: string | Uint8Array,
  signature: string,
) {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(bytes).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

export function razorpay(environment: RazorpayEnvironment) {
  const key = environment.RAZORPAY_KEY_ID;
  const secret = environment.RAZORPAY_KEY_SECRET;
  // Live money requires a separately reviewed launch. There is no mode inferred
  // from browser input, provider payload, deployment name or request hostname.
  if (!key?.match(/^rzp_test_[A-Za-z0-9]+$/) || !secret || secret.length < 16)
    throw new Error('Razorpay test configuration required.');
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: object,
    refundKey?: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`https://api.razorpay.com/v1${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Basic ${btoa(`${key}:${secret}`)}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(refundKey ? { 'X-Refund-Idempotency': refundKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
    } catch {
      throw new ProviderUnavailable();
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderUnavailable(response.status);
    }
    // Provider payloads include contact details. Strip all fields not used here.
    // Bound reads before parsing, including chunked responses.
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderUnavailable();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 262144) throw new Error('Response too large');
        chunks.push(value);
      }
      return schema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch {
      await reader.cancel().catch(() => undefined);
      throw new ProviderUnavailable();
    }
  }
  return {
    keyId: key,
    createOrder(receipt: string, amount: number) {
      z.uuid().parse(receipt);
      money.min(100).parse(amount);
      return request('/orders', orderSchema, {
        amount,
        currency: 'INR',
        receipt,
        partial_payment: false,
      });
    },
    order(id: string) {
      providerId('order').parse(id);
      return request(`/orders/${id}`, orderSchema);
    },
    payment(id: string) {
      providerId('pay').parse(id);
      return request(`/payments/${id}`, paymentSchema);
    },
    async payments(orderId: string) {
      providerId('order').parse(orderId);
      // Razorpay's per-order payments endpoint has no documented pagination.
      // An overfull collection is a case, never a claim that no payment exists.
      const result = await request(
        `/orders/${orderId}/payments`,
        z.object({ count: z.number().int(), items: z.array(paymentSchema) }),
      );
      if (result.count !== result.items.length || result.count > 100)
        throw new ProviderUnavailable();
      return result.items;
    },
    async findOrders(receipt: string) {
      z.uuid().parse(receipt);
      const exact: ProviderOrder[] = [];
      for (let page = 0; page < 10; page++) {
        const query = new URLSearchParams({
          receipt,
          count: '100',
          skip: String(page * 100),
        });
        const result = await request(
          `/orders?${query}`,
          z.object({ count: z.number().int(), items: z.array(orderSchema) }),
        );
        if (result.count !== result.items.length)
          throw new ProviderUnavailable();
        exact.push(...result.items.filter((o) => o.receipt === receipt));
        if (result.items.length < 100) return exact;
      }
      throw new ProviderUnavailable();
    },
    refund(paymentId: string, amount: number, key: string) {
      providerId('pay').parse(paymentId);
      z.uuid().parse(key);
      money.min(100).parse(amount);
      return request(
        `/payments/${paymentId}/refund`,
        refundSchema,
        { amount },
        key,
      );
    },
    async refunds(paymentId: string) {
      providerId('pay').parse(paymentId);
      const result = await request(
        `/payments/${paymentId}/refunds`,
        z.object({ count: z.number().int(), items: z.array(refundSchema) }),
      );
      if (result.count !== result.items.length || result.count > 100)
        throw new ProviderUnavailable();
      return result.items;
    },
  };
}
