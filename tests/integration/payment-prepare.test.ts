import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  holdSeats,
  listSeats,
  releaseHold,
} from '../../packages/backend/src/booking';
import { preparePayment } from '../../packages/backend/src/payment-prepare';
import { saveReservationDetails } from '../../packages/backend/src/reservation-details';
import { createDatabase } from '../../packages/db/src/client';
import {
  cleanupFixtures,
  createCustomers,
  createTrip,
  fixtureClient,
} from '../support/fixtures';

test('checkout freezes a complete owned quote, replays once, and enforces the payment buffer', async () => {
  const owner = await fixtureClient(),
    users = await createCustomers(owner, 2),
    trip = await createTrip(owner);
  const runtime = createDatabase(
      process.env.DATABASE_URL ?? '',
      process.env.CI_DATABASE_PROXY,
    ),
    db = runtime.db;
  const config = {
    PAYMENTS_ENABLED: 'true',
    RAZORPAY_KEY_ID: 'rzp_test_fixture',
    RAZORPAY_KEY_SECRET: 'synthetic-provider-secret',
  };
  let booking = '';
  try {
    await owner.query(
      `INSERT INTO trip_stops(id,trip_id,source_stop_id,city_id,name,address,role,sequence,scheduled_at)
      SELECT gen_random_uuid(),$1,st.id,st.city_id,st.name,st.address,d.role,d.sequence,t.departure_at+d.offset_minutes*interval '1 minute'
      FROM trips t,inventory_service_stops d JOIN stops st ON st.id=d.stop_id WHERE t.id=$1 AND d.service_id='demo-blr-hyd-20'`,
      [trip],
    );
    const stops = (
      await owner.query(
        'SELECT id FROM trip_stops WHERE trip_id=$1 ORDER BY sequence',
        [trip],
      )
    ).rows;
    const hold = await holdSeats(db, users[0].id, randomUUID(), {
      tripId: trip,
      seatLabels: ['1A'],
      expectedTotalMinor: 74900,
      currency: 'INR',
      pickupStopId: stops[0].id,
      dropStopId: stops[3].id,
    });
    expect(hold.status).toBe(201);
    booking = String(hold.body.id);
    const prepare = (user = users[0].id, version = 2, key = randomUUID()) =>
      preparePayment(db, config, user, booking, key, version);
    expect((await prepare(users[1].id)).status).toBe(404);
    expect((await prepare(users[0].id, 1)).body.code).toBe(
      'DETAILS_INCOMPLETE',
    );
    const details = {
      pickupStopId: stops[0].id,
      dropStopId: stops[3].id,
      contactPhone: null,
      passengers: [{ seatLabel: '1A', name: 'Sandbox Traveller' }],
    };
    expect(
      (
        await saveReservationDetails(
          db,
          users[0].id,
          booking,
          randomUUID(),
          1,
          details,
        )
      ).status,
    ).toBe(200);
    expect((await prepare(users[0].id, 1)).status).toBe(412);
    await owner.query(
      "UPDATE bookings SET expires_at=clock_timestamp()+interval '89 seconds' WHERE id=$1",
      [booking],
    );
    expect((await prepare()).body.code).toBe('PAYMENT_DEADLINE');
    await owner.query(
      "UPDATE bookings SET expires_at=clock_timestamp()+interval '9 minutes' WHERE id=$1",
      [booking],
    );
    const key = randomUUID(),
      first = await prepare(users[0].id, 2, key),
      second = await prepare(users[0].id, 2, key);
    expect(first.status).toBe(202);
    expect(second).toEqual(first);
    expect((await prepare()).body.checkoutId).toBe(first.body.checkoutId);
    expect(
      (
        await saveReservationDetails(
          db,
          users[0].id,
          booking,
          randomUUID(),
          2,
          details,
        )
      ).status,
    ).toBe(409);
    expect(
      (await listSeats(db, trip)).find((s) => s.label === '1A')?.available,
    ).toBe(false);
    expect(
      (
        await owner.query(
          'SELECT count(*)::int n FROM payment_intents WHERE booking_id=$1',
          [booking],
        )
      ).rows[0].n,
    ).toBe(1);
    await owner.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1", [
      booking,
    ]);
    expect(
      (await releaseHold(db, users[0].id, randomUUID(), booking)).body.code,
    ).toBe('PAID_CANCELLATION_REQUIRED');
    expect(
      (await listSeats(db, trip)).find((s) => s.label === '1A')?.available,
    ).toBe(false);
  } finally {
    await owner.query(
      'DELETE FROM payment_jobs WHERE resource_id IN(SELECT c.id FROM checkout_attempts c JOIN payment_intents i ON i.id=c.intent_id WHERE i.booking_id=$1)',
      [booking || randomUUID()],
    );
    await owner.query(
      'DELETE FROM checkout_attempts WHERE intent_id IN(SELECT id FROM payment_intents WHERE booking_id=$1)',
      [booking || randomUUID()],
    );
    await owner.query('DELETE FROM payment_intents WHERE booking_id=$1', [
      booking || randomUUID(),
    ]);
    await cleanupFixtures(
      owner,
      [trip],
      users.map((u) => u.id),
    );
    await runtime.close();
    await owner.end();
  }
});
