import { randomUUID } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { releaseHold } from '../../packages/backend/src/booking';
import { claimPaymentJob } from '../../packages/backend/src/payment-jobs';
import { executeRefund } from '../../packages/backend/src/payment-refunds';
import { applyPaymentObservation } from '../../packages/backend/src/payment-state';
import { paymentFixture } from '../support/payments';

const config = {
  RAZORPAY_KEY_ID: 'rzp_test_fixture',
  RAZORPAY_KEY_SECRET: 'synthetic-provider-secret',
};
afterEach(() => vi.unstubAllGlobals());
test('refund success with lost response recovers by fetch and never sends a second POST', async () => {
  const f = await paymentFixture();
  try {
    await releaseHold(f.runtime.db, f.users[0].id, randomUUID(), f.booking);
    await f.runtime.db.transaction((tx) =>
      applyPaymentObservation(tx, f.checkout, f.payment, f.keyId),
    );
    const first = await claimPaymentJob(f.runtime.db);
    if (!first) throw new Error('Missing refund job');
    let posts = 0,
      refunded = false,
      key = '';
    const observed = {
      id: `rfnd_${randomUUID().replaceAll('-', '')}`,
      payment_id: f.payment.id,
      amount: 74900,
      currency: 'INR',
      status: 'processed',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        await f.owner.query('BEGIN');
        try {
          await f.owner.query(
            'SELECT id FROM trips WHERE id=$1 FOR UPDATE NOWAIT',
            [f.trip],
          );
        } finally {
          await f.owner.query('ROLLBACK');
        }
        if (init?.method === 'POST') {
          posts++;
          key = (init.headers as Record<string, string>)[
            'X-Refund-Idempotency'
          ];
          refunded = true;
          expect(JSON.parse(String(init.body))).toEqual({ amount: 74900 });
          throw new Error('injected lost refund response');
        }
        if (url.endsWith('/refunds'))
          return Response.json({
            count: refunded ? 1 : 0,
            items: refunded ? [observed] : [],
          });
        return Response.json({
          ...f.payment,
          amount_refunded: refunded ? 74900 : 0,
        });
      }),
    );
    await executeRefund(f.runtime.db, config, first);
    const refund = (
      await f.owner.query(
        'SELECT id,state FROM payment_refunds WHERE payment_id=$1',
        [f.payment.id],
      )
    ).rows[0];
    expect(refund.state).toBe('UNKNOWN');
    expect(key).toBe(refund.id);
    await f.owner.query(
      "UPDATE payment_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [first.id],
    );
    const retry = await claimPaymentJob(f.runtime.db);
    if (!retry) throw new Error('Missing recovery job');
    await executeRefund(f.runtime.db, config, retry);
    expect(posts).toBe(1);
    expect(
      (
        await f.owner.query(
          'SELECT state,provider_id FROM payment_refunds WHERE id=$1',
          [refund.id],
        )
      ).rows[0],
    ).toEqual({ state: 'PROCESSED', provider_id: observed.id });
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM seat_allocations WHERE booking_id=$1',
          [f.booking],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.owner.query(
          'SELECT state FROM payment_cases WHERE checkout_id=$1',
          [f.checkout],
        )
      ).rows[0].state,
    ).toBe('RESOLVED');
  } finally {
    await f.close();
  }
});

test('refund crash before receiving a response remains read-only when provider lookup is empty', async () => {
  const f = await paymentFixture();
  try {
    await releaseHold(f.runtime.db, f.users[0].id, randomUUID(), f.booking);
    await f.runtime.db.transaction((tx) =>
      applyPaymentObservation(tx, f.checkout, f.payment, f.keyId),
    );
    await f.owner.query(
      "UPDATE payment_refunds SET state='PROCESSING',started_at=clock_timestamp() WHERE payment_id=$1",
      [f.payment.id],
    );
    const job = await claimPaymentJob(f.runtime.db);
    if (!job) throw new Error('Missing job');
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe('GET');
      return Response.json(
        url.endsWith('/refunds') ? { count: 0, items: [] } : f.payment,
      );
    });
    vi.stubGlobal('fetch', fetcher);
    await executeRefund(f.runtime.db, config, job);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      (
        await f.owner.query(
          'SELECT state FROM payment_refunds WHERE payment_id=$1',
          [f.payment.id],
        )
      ).rows[0].state,
    ).toBe('UNKNOWN');
  } finally {
    await f.close();
  }
});
