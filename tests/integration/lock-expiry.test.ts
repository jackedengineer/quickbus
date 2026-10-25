import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from 'vitest';
import {
  cleanupFixtures,
  createCustomers,
  createTrip,
  fixtureClient,
} from '../support/fixtures';

test('a hold expiring while another customer waits for the trip lock is reclaimed using post-lock time', async () => {
  const client = await fixtureClient(),
    observer = await fixtureClient(),
    customers = await createCustomers(client, 2),
    tripId = await createTrip(client, ['1A']);
  const reserve = (index: number) =>
    fetch(`http://localhost:${8787 + index}/api/v1/holds`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
        Cookie: customers[index].cookie,
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({
        tripId,
        seatLabels: ['1A'],
        expectedTotalMinor: 74900,
        currency: 'INR',
      }),
    });
  let waiting: Promise<Response> | undefined;
  try {
    const held = await reserve(0);
    expect(held.status).toBe(201);
    const original = (await held.json()) as { id: string };
    const blocker = await client.query('SELECT pg_backend_pid() AS pid');
    await client.query('BEGIN');
    await client.query('SELECT id FROM trips WHERE id=$1 FOR UPDATE', [tripId]);
    waiting = reserve(1);
    let observed = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const locks = await observer.query(
        'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))) AS waiting',
        [blocker.rows[0].pid],
      );
      if (locks.rows[0].waiting) {
        observed = true;
        break;
      }
      await delay(20);
    }
    expect(observed).toBe(true);
    await client.query(
      `UPDATE bookings SET expires_at=clock_timestamp()+interval '0.5 seconds' WHERE id=$1`,
      [original.id],
    );
    await delay(1000);
    await client.query('COMMIT');
    const replacement = await waiting;
    expect(replacement.status).toBe(201);
    expect(
      (
        await client.query('SELECT status FROM bookings WHERE id=$1', [
          original.id,
        ])
      ).rows[0].status,
    ).toBe('EXPIRED');
    const counts = await client.query(
      `SELECT (SELECT count(*)::int FROM seat_allocations WHERE trip_id=$1) AS allocations,(SELECT count(*)::int FROM bookings WHERE trip_id=$1 AND status='HELD') AS held,(SELECT count(*)::int FROM booking_events WHERE booking_id=$2 AND type='EXPIRED') AS expirations`,
      [tripId, original.id],
    );
    expect(counts.rows[0]).toEqual({ allocations: 1, held: 1, expirations: 1 });
  } finally {
    await client.query('ROLLBACK');
    await waiting?.catch(() => {});
    await cleanupFixtures(
      client,
      [tripId],
      customers.map((c) => c.id),
    );
    await Promise.all([client.end(), observer.end()]);
  }
});
