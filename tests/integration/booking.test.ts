import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  cleanupFixtures,
  createCustomers,
  createTrip,
  fixtureClient,
} from '../support/fixtures';

test('a reservation is atomic, replayable, owned, and rejects a changed request key', async () => {
  const client = await fixtureClient();
  const customers = await createCustomers(client, 2);
  const tripId = await createTrip(client);
  const key = randomUUID();
  const body = {
    tripId,
    seatLabels: ['1A', '1B'],
    expectedTotalMinor: 149800,
    currency: 'INR',
  };
  const reserve = (who: number, requestBody: unknown, requestKey = key) =>
    fetch('http://localhost:8787/api/v1/holds', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Cookie: customers[who].cookie,
        'Idempotency-Key': requestKey,
      },
      body: JSON.stringify(requestBody),
    });
  try {
    const first = await reserve(0, body);
    expect(first.status).toBe(201);
    const original = (await first.json()) as { id: string };
    const replay = await reserve(0, body);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(original);
    const changed = await reserve(0, { ...body, seatLabels: ['1C'] });
    expect(changed.status).toBe(422);
    const overlap = await reserve(
      1,
      { ...body, seatLabels: ['1B', '1C'] },
      randomUUID(),
    );
    expect(overlap.status).toBe(409);
    expect(await overlap.json()).toMatchObject({
      code: 'SEATS_UNAVAILABLE',
      unavailableSeatLabels: ['1B'],
    });
    const count = await client.query(
      'SELECT seat_label FROM seat_allocations WHERE trip_id=$1 ORDER BY seat_label',
      [tripId],
    );
    expect(count.rows.map((r) => r.seat_label)).toEqual(['1A', '1B']);
    const other = await fetch(
      `http://localhost:8787/api/v1/bookings/${original.id}`,
      { headers: { Cookie: customers[1].cookie } },
    );
    expect(other.status).toBe(404);
  } finally {
    await cleanupFixtures(
      client,
      [tripId],
      customers.map((c) => c.id),
    );
    await client.end();
  }
});

test('unpaid release is replayable and mutation routes reject anonymous and cross-origin requests', async () => {
  const client = await fixtureClient();
  const customers = await createCustomers(client, 1);
  const tripId = await createTrip(client);
  const body = {
    tripId,
    seatLabels: ['1A'],
    expectedTotalMinor: 74900,
    currency: 'INR',
  };
  const headers = {
    'Content-Type': 'application/json',
    Origin: 'http://localhost:3000',
    Cookie: customers[0].cookie,
    'Idempotency-Key': randomUUID(),
  };
  try {
    const anonymous = await fetch('http://localhost:8787/api/v1/holds', {
      method: 'POST',
      headers: { ...headers, Cookie: '' },
      body: JSON.stringify(body),
    });
    expect(anonymous.status).toBe(401);
    const forged = await fetch('http://localhost:8787/api/v1/holds', {
      method: 'POST',
      headers: { ...headers, Origin: 'https://untrusted.example' },
      body: JSON.stringify(body),
    });
    expect(forged.status).toBe(403);
    const held = await fetch('http://localhost:8787/api/v1/holds', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    expect(held.status).toBe(201);
    const booking = (await held.json()) as { id: string };
    const key = randomUUID();
    for (let i = 0; i < 2; i++) {
      const released = await fetch(
        `http://localhost:8787/api/v1/bookings/${booking.id}/release`,
        {
          method: 'POST',
          headers: { ...headers, 'Idempotency-Key': key },
          body: '{}',
        },
      );
      expect(released.status).toBe(200);
    }
    expect(
      (
        await client.query(
          'SELECT count(*)::int AS count FROM seat_allocations WHERE trip_id=$1',
          [tripId],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await client.query(
          `SELECT count(*)::int AS count FROM booking_events WHERE booking_id=$1 AND type='CANCELLED'`,
          [booking.id],
        )
      ).rows[0].count,
    ).toBe(1);
  } finally {
    await cleanupFixtures(
      client,
      [tripId],
      customers.map((c) => c.id),
    );
    await client.end();
  }
});

test('inverse seat ordering across two Worker instances cannot deadlock or split a party', async () => {
  const client = await fixtureClient(),
    customers = await createCustomers(client, 2),
    tripId = await createTrip(client);
  try {
    const responses = await Promise.all(
      [
        ['1A', '1B'],
        ['1B', '1A'],
      ].map((seatLabels, i) =>
        fetch(`http://localhost:${8787 + i}/api/v1/holds`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:3000',
            Cookie: customers[i].cookie,
            'Idempotency-Key': randomUUID(),
          },
          body: JSON.stringify({
            tripId,
            seatLabels,
            expectedTotalMinor: 149800,
            currency: 'INR',
          }),
        }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const allocations = await client.query(
      'SELECT booking_id,seat_label FROM seat_allocations WHERE trip_id=$1 ORDER BY seat_label',
      [tripId],
    );
    expect(allocations.rows.map((r) => r.seat_label)).toEqual(['1A', '1B']);
    expect(new Set(allocations.rows.map((r) => r.booking_id)).size).toBe(1);
  } finally {
    await cleanupFixtures(
      client,
      [tripId],
      customers.map((c) => c.id),
    );
    await client.end();
  }
});
