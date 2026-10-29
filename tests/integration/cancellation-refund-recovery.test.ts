import { randomUUID } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { cancelCustomerBooking } from '../../packages/backend/src/cancellation';
import { claimPaymentJob } from '../../packages/backend/src/payment-jobs';
import { executeRefund } from '../../packages/backend/src/payment-refunds';
import { applyPaymentObservation } from '../../packages/backend/src/payment-state';
import { paymentFixture } from '../support/payments';

const config = {
  RAZORPAY_KEY_ID: 'rzp_test_fixture',
  RAZORPAY_KEY_SECRET: 'synthetic-provider-secret',
};
afterEach(() => vi.unstubAllGlobals());

test('paid cancellation with a lost refund response recovers read-only and never revives its seats', async () => {
  const f = await paymentFixture();
  try {
    await f.runtime.db.transaction((tx) =>
      applyPaymentObservation(tx, f.checkout, f.payment, f.keyId),
    );
    await cancelCustomerBooking(
      f.runtime.db,
      f.users[0].id,
      f.booking,
      randomUUID(),
      1,
    );
    const refund = (
      await f.owner.query(
        'SELECT id FROM payment_refunds WHERE payment_id=$1',
        [f.payment.id],
      )
    ).rows[0];
    const job = await claimPaymentJob(f.runtime.db, refund.id);
    if (!job) throw Error('Missing refund job');
    let accepted = false,
      posts = 0;
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
        if (init?.method === 'POST') {
          posts++;
          expect(
            (init.headers as Record<string, string>)['X-Refund-Idempotency'],
          ).toBe(refund.id);
          accepted = true;
          throw Error('accepted response lost');
        }
        return Response.json(
          url.endsWith('/refunds')
            ? { count: accepted ? 1 : 0, items: accepted ? [observed] : [] }
            : { ...f.payment, amount_refunded: accepted ? 74900 : 0 },
        );
      }),
    );
    await executeRefund(f.runtime.db, config, job);
    expect(
      (
        await f.owner.query('SELECT state FROM payment_refunds WHERE id=$1', [
          refund.id,
        ])
      ).rows[0].state,
    ).toBe('UNKNOWN');
    await f.owner.query(
      'UPDATE payment_jobs SET available_at=clock_timestamp() WHERE id=$1',
      [job.id],
    );
    const retry = await claimPaymentJob(f.runtime.db, refund.id);
    if (!retry) throw Error('Missing recovery');
    await executeRefund(f.runtime.db, config, retry);
    await f.runtime.db.transaction((tx) =>
      applyPaymentObservation(
        tx,
        f.checkout,
        { ...f.payment, status: 'refunded', amount_refunded: 74900 },
        f.keyId,
      ),
    );
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
        await f.owner.query('SELECT status FROM bookings WHERE id=$1', [
          f.booking,
        ])
      ).rows[0].status,
    ).toBe('CANCELLED');
    expect(
      (
        await f.owner.query(
          'SELECT booking_id FROM seat_allocations WHERE booking_id=$1',
          [f.booking],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await f.close();
  }
});

test('cancellation fault after refund intent rolls back money, seats and command replay together', async () => {
  const f = await paymentFixture(),
    name = `cancel_fault_${randomUUID().replaceAll('-', '')}`,
    key = randomUUID();
  try {
    await f.runtime.db.transaction((tx) =>
      applyPaymentObservation(tx, f.checkout, f.payment, f.keyId),
    );
    await f.owner.query(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.booking_id='${f.booking}'::uuid THEN RAISE EXCEPTION 'injected cancellation failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`,
    );
    await f.owner.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON booking_cancellations FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    await expect(
      cancelCustomerBooking(f.runtime.db, f.users[0].id, f.booking, key, 1),
    ).rejects.toThrow();
    const audit = (
      await f.owner.query(
        `SELECT b.status,p.disposition,(SELECT count(*)::int FROM seat_allocations WHERE booking_id=b.id) allocations,
    (SELECT count(*)::int FROM payment_refunds WHERE payment_id=p.id) refunds,(SELECT count(*)::int FROM idempotency_keys WHERE key=$2) commands
    FROM bookings b JOIN payment_intents i ON i.booking_id=b.id JOIN provider_payments p ON p.intent_id=i.id WHERE b.id=$1`,
        [f.booking, key],
      )
    ).rows[0];
    expect(audit).toEqual({
      status: 'CONFIRMED',
      disposition: 'FULFILLED',
      allocations: 1,
      refunds: 0,
      commands: 0,
    });
    await f.owner.query(`DROP TRIGGER ${name} ON booking_cancellations`);
    expect(
      (
        await cancelCustomerBooking(
          f.runtime.db,
          f.users[0].id,
          f.booking,
          key,
          1,
        )
      ).status,
    ).toBe(200);
  } finally {
    await f.owner.query(
      `DROP TRIGGER IF EXISTS ${name} ON booking_cancellations`,
    );
    await f.owner.query(`DROP FUNCTION IF EXISTS ${name}()`);
    await f.close();
  }
});

test('a second captured attempt refunds separately before and after whole-booking cancellation', async () => {
  const f = await paymentFixture(),
    second = randomUUID(),
    order = `order_${randomUUID().replaceAll('-', '')}`;
  try {
    await f.owner.query(
      "UPDATE checkout_attempts SET state='FAILED' WHERE id=$1",
      [f.checkout],
    );
    await f.owner.query(
      "INSERT INTO checkout_attempts(id,intent_id,number,state,order_id) VALUES($1,$2,2,'READY',$3)",
      [second, f.intent, order],
    );
    await f.runtime.db.transaction((tx) =>
      applyPaymentObservation(tx, f.checkout, f.payment, f.keyId),
    );
    const extra = {
      ...f.payment,
      id: `pay_${randomUUID().replaceAll('-', '')}`,
      order_id: order,
    };
    await f.runtime.db.transaction((tx) =>
      applyPaymentObservation(tx, second, extra, f.keyId),
    );
    expect(
      (
        await f.owner.query('SELECT status FROM bookings WHERE id=$1', [
          f.booking,
        ])
      ).rows[0].status,
    ).toBe('CONFIRMED');
    await cancelCustomerBooking(
      f.runtime.db,
      f.users[0].id,
      f.booking,
      randomUUID(),
      1,
    );
    await f.runtime.db.transaction((tx) =>
      applyPaymentObservation(tx, second, extra, f.keyId),
    );
    const audit = (
      await f.owner.query(
        `SELECT count(*)::int refunds,sum(r.amount)::int total FROM payment_refunds r JOIN provider_payments p ON p.id=r.payment_id WHERE p.intent_id=$1`,
        [f.intent],
      )
    ).rows[0];
    expect(audit).toEqual({ refunds: 2, total: 149800 });
    expect(
      (
        await f.owner.query(
          "SELECT id FROM booking_events WHERE booking_id=$1 AND type='CONFIRMED'",
          [f.booking],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await f.owner.query(
          'SELECT booking_id FROM seat_allocations WHERE booking_id=$1',
          [f.booking],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await f.close();
  }
});
