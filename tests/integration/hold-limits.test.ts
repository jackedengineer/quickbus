import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  cleanupFixtures,
  createCustomers,
  createTrip,
  fixtureClient,
} from '../support/fixtures';

const reserve = (cookie: string, tripId: string) =>
  fetch('http://localhost:8787/api/v1/holds', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
      Cookie: cookie,
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify({
      tripId,
      seatLabels: ['1A'],
      expectedTotalMinor: 74900,
      currency: 'INR',
    }),
  });

test('one account cannot hold seats on more than three trips at once, even concurrently', async () => {
  const client = await fixtureClient();
  const [customer] = await createCustomers(client, 1);
  const trips = await Promise.all(
    [1, 2, 3, 4, 5].map(() => createTrip(client)),
  );
  try {
    // Five simultaneous holds on five different trips: the customer row lock
    // must serialise the budget, so exactly three win and two are refused.
    const results = await Promise.all(
      trips.map((tripId) => reserve(customer.cookie, tripId)),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 201, 201, 429, 429]);
    const refused = results.find((r) => r.status === 429);
    expect(await refused?.json()).toMatchObject({ code: 'HOLD_LIMIT_REACHED' });
    const live = await client.query(
      `SELECT count(*)::int AS n FROM bookings WHERE user_id=$1 AND status='HELD'`,
      [customer.id],
    );
    expect(live.rows[0].n).toBe(3);

    // Releasing one frees the budget for another trip.
    const held = results.findIndex((r) => r.status === 201);
    const booking = (await results[held].clone().json()) as { id: string };
    const release = await fetch(
      `http://localhost:8787/api/v1/bookings/${booking.id}/release`,
      {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          Cookie: customer.cookie,
          'Idempotency-Key': randomUUID(),
        },
      },
    );
    expect(release.status).toBe(200);
    const refusedTrip = trips[results.findIndex((r) => r.status === 429)];
    expect((await reserve(customer.cookie, refusedTrip)).status).toBe(201);
  } finally {
    await cleanupFixtures(client, trips, [customer.id]);
    await client.end();
  }
});
