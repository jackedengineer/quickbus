import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { preparePayment } from '../../packages/backend/src/payment-prepare';
import { paymentFixture } from '../support/payments';

test('independent Workers share a checkout budget across trips without charging idempotent retries', async () => {
  const a = await paymentFixture(),
    b = await paymentFixture();
  const config = {
    PAYMENTS_ENABLED: 'true',
    RAZORPAY_KEY_ID: a.keyId,
    RAZORPAY_KEY_SECRET: 'synthetic-provider-secret',
  };
  try {
    await b.owner.query('UPDATE bookings SET user_id=$1 WHERE id=$2', [
      a.users[0].id,
      b.booking,
    ]);
    for (const f of [a, b]) {
      await f.owner.query(
        `INSERT INTO trip_stops(id,trip_id,source_stop_id,city_id,name,address,role,sequence,scheduled_at)
        SELECT gen_random_uuid(),$1,s.id,s.city_id,s.name,s.address,d.role,d.sequence,t.departure_at+d.offset_minutes*interval '1 minute'
        FROM trips t,inventory_service_stops d JOIN stops s ON s.id=d.stop_id WHERE t.id=$1 AND d.service_id='demo-blr-hyd-20'`,
        [f.trip],
      );
      const stops = (
        await f.owner.query(
          'SELECT id FROM trip_stops WHERE trip_id=$1 ORDER BY sequence',
          [f.trip],
        )
      ).rows;
      await f.owner.query(
        `UPDATE bookings SET pickup_stop_id=$2,drop_stop_id=$3,
        contact_email=(SELECT email FROM "user" WHERE id=bookings.user_id) WHERE id=$1`,
        [f.booking, stops[0].id, stops[3].id],
      );
      await f.owner.query(
        "UPDATE booking_items SET passenger_name='Synthetic payment traveller' WHERE booking_id=$1",
        [f.booking],
      );
      await f.owner.query(
        "UPDATE checkout_attempts SET state='FAILED' WHERE id=$1",
        [f.checkout],
      );
    }
    // Two original attempts plus seven retained failures: one slot remains.
    for (let number = 2; number <= 8; number++)
      await a.owner.query(
        "INSERT INTO checkout_attempts(id,intent_id,number,state) VALUES($1,$2,$3,'FAILED')",
        [randomUUID(), a.intent, number],
      );
    const keys = [randomUUID(), randomUUID()];
    const result = await Promise.all(
      [a, b].map((f, index) =>
        preparePayment(
          f.runtime.db,
          config,
          a.users[0].id,
          f.booking,
          keys[index],
          1,
        ),
      ),
    );
    expect(result.map((r) => r.status).sort()).toEqual([202, 429]);
    expect(result.find((r) => r.status === 429)?.body.code).toBe(
      'PAYMENT_RATE_LIMIT',
    );
    const winner = result[0].status === 202 ? 0 : 1,
      fixture = [a, b][winner];
    expect(
      await preparePayment(
        fixture.runtime.db,
        config,
        a.users[0].id,
        fixture.booking,
        keys[winner],
        1,
      ),
    ).toEqual(result[winner]);
    // A different HTTP key also resumes the same unresolved checkout at quota.
    expect(
      (
        await preparePayment(
          fixture.runtime.db,
          config,
          a.users[0].id,
          fixture.booking,
          randomUUID(),
          1,
        )
      ).body.checkoutId,
    ).toBe(result[winner].body.checkoutId);
    const count = await a.owner.query(
      'SELECT count(*)::int n FROM checkout_attempts WHERE intent_id=ANY($1::uuid[])',
      [[a.intent, b.intent]],
    );
    expect(count.rows[0].n).toBe(10);
    await expect(
      a.owner.query(
        "INSERT INTO payment_jobs(id,kind,resource_id,lease_token) VALUES($1,'ORDER',$2,$3)",
        [randomUUID(), randomUUID(), randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await b.close();
    await a.close();
  }
});
