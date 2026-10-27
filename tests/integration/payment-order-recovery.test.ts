import { afterEach, expect, test, vi } from 'vitest';
import {
  claimPaymentJob,
  enqueuePaymentJob,
  finishPaymentJob,
} from '../../packages/backend/src/payment-jobs';
import { createCheckoutOrder } from '../../packages/backend/src/payment-orders';
import { reconcileCheckout } from '../../packages/backend/src/payment-reconcile';
import { paymentFixture } from '../support/payments';

const config = {
  RAZORPAY_KEY_ID: 'rzp_test_fixture',
  RAZORPAY_KEY_SECRET: 'synthetic-provider-secret',
};
afterEach(() => vi.unstubAllGlobals());
test('lost order-create response is reconciled without a second POST or network under trip lock', async () => {
  const f = await paymentFixture();
  try {
    await f.owner.query(
      "UPDATE checkout_attempts SET state='PENDING',order_id=NULL WHERE id=$1",
      [f.checkout],
    );
    await f.runtime.db.transaction((tx) =>
      enqueuePaymentJob(tx, 'ORDER', f.checkout),
    );
    const job = await claimPaymentJob(f.runtime.db);
    if (!job) throw new Error('Missing order job');
    let posts = 0;
    const order = {
      id: f.payment.order_id,
      receipt: f.checkout,
      amount: 74900,
      currency: 'INR',
      status: 'created',
      amount_paid: null,
      amount_due: 74900,
      attempts: 0,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        // This separate owner connection would fail NOWAIT if the runtime were
        // holding the trip lock while calling the provider.
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
          throw new Error('injected lost response after provider accepted');
        }
        if (url.includes('/payments'))
          return Response.json({ count: 0, items: [] });
        if (url.includes('/orders?'))
          return Response.json({ count: 1, items: [order] });
        return Response.json(order);
      }),
    );
    await createCheckoutOrder(f.runtime.db, config, job);
    expect(posts).toBe(1);
    expect(
      (
        await f.owner.query('SELECT state FROM checkout_attempts WHERE id=$1', [
          f.checkout,
        ])
      ).rows[0].state,
    ).toBe('UNKNOWN');
    await f.runtime.db.transaction((tx) =>
      enqueuePaymentJob(tx, 'RECONCILE', f.checkout),
    );
    const recovery = await claimPaymentJob(f.runtime.db);
    if (!recovery) throw new Error('Missing reconciliation job');
    await reconcileCheckout(f.runtime.db, config, recovery);
    expect(posts).toBe(1);
    expect(
      (
        await f.owner.query(
          'SELECT state,order_id FROM checkout_attempts WHERE id=$1',
          [f.checkout],
        )
      ).rows[0],
    ).toEqual({ state: 'READY', order_id: f.payment.order_id });
  } finally {
    await f.close();
  }
});

test('an expired order worker never creates again and empty receipt lookup stays UNKNOWN', async () => {
  const f = await paymentFixture();
  try {
    await f.owner.query(
      "UPDATE checkout_attempts SET state='CREATING',order_id=NULL,started_at=clock_timestamp()-interval '2 minutes' WHERE id=$1",
      [f.checkout],
    );
    await f.runtime.db.transaction((tx) =>
      enqueuePaymentJob(tx, 'ORDER', f.checkout),
    );
    const job = await claimPaymentJob(f.runtime.db);
    if (!job) throw new Error('Missing order job');
    const fetcher = vi.fn(async () => Response.json({ count: 0, items: [] }));
    vi.stubGlobal('fetch', fetcher);
    await createCheckoutOrder(f.runtime.db, config, job);
    expect(fetcher).not.toHaveBeenCalled();
    await f.runtime.db.transaction((tx) =>
      enqueuePaymentJob(tx, 'RECONCILE', f.checkout),
    );
    const recovery = await claimPaymentJob(f.runtime.db);
    if (!recovery) throw new Error('Missing recovery job');
    await reconcileCheckout(f.runtime.db, config, recovery);
    expect(fetcher.mock.calls).toHaveLength(1);
    expect(
      (
        await f.owner.query(
          'SELECT state,order_id FROM checkout_attempts WHERE id=$1',
          [f.checkout],
        )
      ).rows[0],
    ).toEqual({ state: 'UNKNOWN', order_id: null });
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM payment_cases WHERE checkout_id=$1',
          [f.checkout],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      await f.runtime.db.transaction((tx) => finishPaymentJob(tx, job)),
    ).toBe(false);
  } finally {
    await f.close();
  }
});
