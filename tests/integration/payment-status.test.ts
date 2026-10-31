import { createHmac } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  paymentHint,
  paymentStatus,
} from '../../packages/backend/src/payment-status';
import { paymentFixture } from '../support/payments';

test('owned payment status and signed callback cannot bypass authoritative capture', async () => {
  const f = await paymentFixture(),
    config = {
      PAYMENTS_ENABLED: 'true',
      RAZORPAY_KEY_ID: 'rzp_test_fixture',
      RAZORPAY_KEY_SECRET: 'synthetic-provider-secret',
    };
  try {
    expect(
      await paymentStatus(f.runtime.db, config, f.users[1].id, f.booking),
    ).toBeNull();
    expect(
      (
        await paymentHint(
          f.runtime.db,
          config,
          f.users[1].id,
          f.booking,
          f.checkout,
        )
      ).status,
    ).toBe(404);
    const active = await paymentStatus(
      f.runtime.db,
      config,
      f.users[0].id,
      f.booking,
    );
    expect(active?.checkout?.canOpen).toBe(true);
    expect(active?.checkout?.keyId).toBe(config.RAZORPAY_KEY_ID);
    await f.owner.query(
      "INSERT INTO payment_jobs(id,kind,resource_id,available_at) VALUES(gen_random_uuid(),'RECONCILE',$1,clock_timestamp())",
      [f.checkout],
    );
    const checking = await paymentStatus(
      f.runtime.db,
      config,
      f.users[0].id,
      f.booking,
    );
    expect(checking?.checkout).toMatchObject({
      checking: true,
      canOpen: false,
    });
    expect(checking?.checkout?.orderId).toBeUndefined();
    // A successful check schedules its next safety read in the future. A
    // provider failure must continue blocking reopen even during backoff.
    await f.owner.query(
      "UPDATE payment_jobs SET available_at=clock_timestamp()+interval '30 seconds',failure_code='PROVIDER_UNAVAILABLE' WHERE resource_id=$1",
      [f.checkout],
    );
    expect(
      (await paymentStatus(f.runtime.db, config, f.users[0].id, f.booking))
        ?.checkout?.canOpen,
    ).toBe(false);
    await f.owner.query(
      'UPDATE payment_jobs SET failure_code=NULL WHERE resource_id=$1',
      [f.checkout],
    );
    expect(
      (await paymentStatus(f.runtime.db, config, f.users[0].id, f.booking))
        ?.checkout?.canOpen,
    ).toBe(true);
    const sign = (orderId: string) =>
      createHmac('sha256', config.RAZORPAY_KEY_SECRET)
        .update(`${orderId}|${f.payment.id}`)
        .digest('hex');
    expect(
      (
        await paymentHint(
          f.runtime.db,
          config,
          f.users[0].id,
          f.booking,
          f.checkout,
          { paymentId: f.payment.id, signature: sign('order_forged') },
        )
      ).status,
    ).toBe(401);
    for (let n = 0; n < 2; n++)
      expect(
        (
          await paymentHint(
            f.runtime.db,
            config,
            f.users[0].id,
            f.booking,
            f.checkout,
            { paymentId: f.payment.id, signature: sign(f.payment.order_id) },
          )
        ).status,
      ).toBe(202);
    expect(
      (
        await f.owner.query('SELECT status FROM bookings WHERE id=$1', [
          f.booking,
        ])
      ).rows[0].status,
    ).toBe('PAYMENT_PENDING');
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM provider_payments WHERE intent_id=$1',
          [f.intent],
        )
      ).rows[0].n,
    ).toBe(0);
    await f.owner.query(
      "UPDATE bookings SET expires_at=clock_timestamp()+interval '89 seconds' WHERE id=$1",
      [f.booking],
    );
    const late = await paymentStatus(
      f.runtime.db,
      config,
      f.users[0].id,
      f.booking,
    );
    expect(late?.checkout?.canOpen).toBe(false);
    expect(late?.checkout?.keyId).toBeUndefined();
  } finally {
    await f.close();
  }
});
