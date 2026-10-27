import { createHmac, randomUUID } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import {
  ProviderUnavailable,
  razorpay,
  verifySignature,
} from '../../packages/backend/src/razorpay';

const config = {
  RAZORPAY_KEY_ID: 'rzp_test_fixture',
  RAZORPAY_KEY_SECRET: 'synthetic-provider-secret',
};
const receipt = randomUUID();
const order = {
  id: 'order_fixture',
  receipt,
  amount: 74900,
  currency: 'INR',
  status: 'created',
  amount_paid: 0,
  amount_due: 74900,
  attempts: 0,
  notes: {},
};
afterEach(() => vi.unstubAllGlobals());

test('rejects live credentials and forged, malformed or mutated signatures', () => {
  expect(() =>
    razorpay({ ...config, RAZORPAY_KEY_ID: 'rzp_live_fixture' }),
  ).toThrow();
  const raw = '{"event":"payment.captured"}';
  const signature = createHmac('sha256', config.RAZORPAY_KEY_SECRET)
    .update(raw)
    .digest('hex');
  expect(verifySignature(config.RAZORPAY_KEY_SECRET, raw, signature)).toBe(
    true,
  );
  expect(
    verifySignature(config.RAZORPAY_KEY_SECRET, `${raw} `, signature),
  ).toBe(false);
  expect(verifySignature(config.RAZORPAY_KEY_SECRET, raw, '00')).toBe(false);
});

test('a lost create response is ambiguous and never automatically retried', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('socket failed'));
  vi.stubGlobal('fetch', fetcher);
  await expect(
    razorpay(config).createOrder(receipt, 74900),
  ).rejects.toBeInstanceOf(ProviderUnavailable);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('Workers-compatible manual redirects never forward provider credentials', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { Location: 'https://untrusted.invalid/' },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  await expect(
    razorpay(config).createOrder(receipt, 74900),
  ).rejects.toMatchObject({ httpStatus: 302, phase: 'http' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1].redirect).toBe('manual');
});

test('receipt lookup filters exact matches and follows pagination', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        count: 100,
        items: Array.from({ length: 100 }, () => ({
          ...order,
          receipt: `${receipt}x`,
        })),
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ count: 1, items: [{ ...order, amount_paid: null }] }),
    );
  vi.stubGlobal('fetch', fetcher);
  expect(await razorpay(config).findOrders(receipt)).toEqual([
    { ...order, amount_paid: null },
  ]);
  expect(fetcher.mock.calls[1][0]).toContain('skip=100');
});

test('refund replay uses the same key and exact body; provider PII is stripped', async () => {
  const refund = {
    id: 'rfnd_fixture',
    payment_id: 'pay_fixture',
    amount: 74900,
    currency: 'INR',
    status: 'processed',
  };
  const fetcher = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(Response.json({ ...refund, contact: 'private' })),
    );
  vi.stubGlobal('fetch', fetcher);
  const api = razorpay(config),
    key = randomUUID();
  expect(await api.refund('pay_fixture', 74900, key)).toEqual(refund);
  await api.refund('pay_fixture', 74900, key);
  expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  expect(fetcher.mock.calls[1][1].headers['X-Refund-Idempotency']).toBe(key);
});

test('malformed and oversized successful responses remain ambiguous', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: 'order_bad' }))
      .mockResolvedValueOnce(new Response(' '.repeat(262145))),
  );
  await expect(
    razorpay(config).createOrder(receipt, 74900),
  ).rejects.toBeInstanceOf(ProviderUnavailable);
  await expect(
    razorpay(config).createOrder(receipt, 74900),
  ).rejects.toBeInstanceOf(ProviderUnavailable);
});
