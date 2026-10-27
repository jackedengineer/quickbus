import { randomUUID } from 'node:crypto';
import { holdSeats } from '../../packages/backend/src/booking';
import type { ProviderPayment } from '../../packages/backend/src/razorpay';
import { createDatabase } from '../../packages/db/src/client';
import {
  cleanupFixtures,
  createCustomers,
  createTrip,
  fixtureClient,
} from './fixtures';

export async function paymentFixture() {
  const owner = await fixtureClient(),
    users = await createCustomers(owner, 2),
    trip = await createTrip(owner, ['1A']);
  const runtime = createDatabase(
    process.env.DATABASE_URL ?? '',
    process.env.CI_DATABASE_PROXY,
  );
  const held = await holdSeats(runtime.db, users[0].id, randomUUID(), {
    tripId: trip,
    seatLabels: ['1A'],
    expectedTotalMinor: 74900,
    currency: 'INR',
  });
  if (held.status !== 201) throw new Error('Payment fixture hold failed');
  const booking = String(held.body.id),
    intent = randomUUID(),
    checkout = randomUUID();
  const orderId = `order_${randomUUID().replaceAll('-', '')}`;
  const keyId = 'rzp_test_fixture';
  await owner.query(
    "UPDATE bookings SET status='PAYMENT_PENDING' WHERE id=$1",
    [booking],
  );
  await owner.query(
    'INSERT INTO payment_intents(id,booking_id,amount,key_id) VALUES($1,$2,74900,$3)',
    [intent, booking, keyId],
  );
  await owner.query(
    "INSERT INTO checkout_attempts(id,intent_id,number,state,order_id) VALUES($1,$2,1,'READY',$3)",
    [checkout, intent, orderId],
  );
  const payment: ProviderPayment = {
    id: `pay_${randomUUID().replaceAll('-', '')}`,
    order_id: orderId,
    amount: 74900,
    currency: 'INR',
    status: 'captured',
    captured: true,
    amount_refunded: 0,
  };
  return {
    owner,
    users,
    trip,
    runtime,
    booking,
    intent,
    checkout,
    payment,
    keyId,
    async close() {
      await owner.query(
        'DELETE FROM payment_jobs WHERE resource_id IN(SELECT id FROM checkout_attempts WHERE intent_id=$1) OR resource_id IN(SELECT r.id FROM payment_refunds r JOIN provider_payments p ON p.id=r.payment_id WHERE p.intent_id=$1)',
        [intent],
      );
      await owner.query(
        'DELETE FROM payment_cases WHERE checkout_id IN(SELECT id FROM checkout_attempts WHERE intent_id=$1)',
        [intent],
      );
      await owner.query(
        'DELETE FROM payment_refunds WHERE payment_id IN(SELECT id FROM provider_payments WHERE intent_id=$1)',
        [intent],
      );
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
        users.map((u) => u.id),
      );
      await runtime.close();
      await owner.end();
    },
  };
}
