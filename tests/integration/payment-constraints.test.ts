import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  cleanupFixtures,
  createCustomers,
  createTrip,
  fixtureClient,
} from '../support/fixtures';

test('payment identities reject duplicate intents, unresolved checkouts and fulfillment', async () => {
  const owner = await fixtureClient(),
    customers = await createCustomers(owner, 1);
  const trip = await createTrip(owner),
    booking = randomUUID(),
    intent = randomUUID(),
    checkout = randomUUID();
  const payA = `pay_${randomUUID().replaceAll('-', '')}`,
    payB = `pay_${randomUUID().replaceAll('-', '')}`;
  try {
    await owner.query(
      "INSERT INTO bookings(id,trip_id,user_id,reference,total_minor,expires_at) VALUES($1::uuid,$2,$3,$1::text,74900,clock_timestamp()+interval '10 minutes')",
      [booking, trip, customers[0].id],
    );
    await owner.query(
      "INSERT INTO payment_intents(id,booking_id,amount,key_id) VALUES($1,$2,74900,'rzp_test_fixture')",
      [intent, booking],
    );
    await expect(
      owner.query(
        "INSERT INTO payment_intents(id,booking_id,amount,key_id) VALUES($1,$2,74900,'rzp_test_fixture')",
        [randomUUID(), booking],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await owner.query(
      'INSERT INTO checkout_attempts(id,intent_id,number) VALUES($1,$2,1)',
      [checkout, intent],
    );
    await expect(
      owner.query(
        'INSERT INTO checkout_attempts(id,intent_id,number) VALUES($1,$2,2)',
        [randomUUID(), intent],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      owner.query("UPDATE checkout_attempts SET state='READY' WHERE id=$1", [
        checkout,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await owner.query(
      "INSERT INTO provider_payments(id,checkout_id,intent_id,amount,currency,state,disposition) VALUES($1,$2,$3,74900,'INR','captured','FULFILLED')",
      [payA, checkout, intent],
    );
    await expect(
      owner.query(
        "INSERT INTO provider_payments(id,checkout_id,intent_id,amount,currency,state,disposition) VALUES($1,$2,$3,74900,'INR','captured','FULFILLED')",
        [payB, checkout, intent],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await owner.query(
      'INSERT INTO payment_refunds(id,payment_id,amount) VALUES($1,$2,74900)',
      [randomUUID(), payA],
    );
    await expect(
      owner.query(
        'INSERT INTO payment_refunds(id,payment_id,amount) VALUES($1,$2,74900)',
        [randomUUID(), payA],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await owner.query(
      "UPDATE checkout_attempts SET state='FAILED' WHERE id=$1",
      [checkout],
    );
    await owner.query(
      'INSERT INTO checkout_attempts(id,intent_id,number) VALUES($1,$2,2)',
      [randomUUID(), intent],
    );
  } finally {
    await owner.query('DELETE FROM payment_refunds WHERE payment_id=$1', [
      payA,
    ]);
    await owner.query('DELETE FROM provider_payments WHERE intent_id=$1', [
      intent,
    ]);
    await owner.query('DELETE FROM checkout_attempts WHERE intent_id=$1', [
      intent,
    ]);
    await owner.query('DELETE FROM payment_intents WHERE id=$1', [intent]);
    await cleanupFixtures(
      owner,
      [trip],
      customers.map((c) => c.id),
    );
    await owner.end();
  }
});
