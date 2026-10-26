import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  cleanupFixtures,
  createCustomers,
  createTrip,
  fixtureClient,
} from '../support/fixtures';

const origin = 'http://localhost:3000';
test('overlapping scheduled expiry preserves live holds and expires each due party exactly once', async () => {
  const owner = await fixtureClient();
  const customers = await createCustomers(owner, 2);
  const trip = await createTrip(owner, ['1A', '1B', '1C']);
  try {
    const hold = async (index: number, seats: string[]) => {
      const response = await fetch('http://localhost:8787/api/v1/holds', {
        method: 'POST',
        headers: {
          Origin: origin,
          Cookie: customers[index].cookie,
          'Content-Type': 'application/json',
          'Idempotency-Key': randomUUID(),
        },
        body: JSON.stringify({
          tripId: trip,
          seatLabels: seats,
          expectedTotalMinor: 74900 * seats.length,
          currency: 'INR',
        }),
      });
      expect(response.status).toBe(201);
      return ((await response.json()) as { id: string }).id;
    };
    const due = await hold(0, ['1A', '1B']),
      live = await hold(1, ['1C']);
    await owner.query(
      "UPDATE bookings SET expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
      [due],
    );
    const invoke = () =>
      fetch(
        'http://localhost:8787/cdn-cgi/local/scheduled?cron=*+*+*+*+*&format=json',
      );
    const results = await Promise.all([invoke(), invoke()]);
    expect(results.every((r) => r.ok)).toBe(true);
    const audit = await owner.query(
      `SELECT b.status,
      (SELECT count(*)::int FROM seat_allocations WHERE booking_id=b.id) allocations,
      (SELECT count(*)::int FROM booking_events WHERE booking_id=b.id AND type='EXPIRED') events
      FROM bookings b WHERE b.id=$1`,
      [due],
    );
    expect(audit.rows[0]).toEqual({
      status: 'EXPIRED',
      allocations: 0,
      events: 1,
    });
    const active = await owner.query(
      'SELECT status FROM bookings WHERE id=$1',
      [live],
    );
    expect(active.rows[0].status).toBe('HELD');
    const heartbeat = await owner.query(
      "SELECT last_succeeded_at IS NOT NULL ok FROM maintenance_jobs WHERE name='expiry'",
    );
    expect(heartbeat.rows[0].ok).toBe(true);
  } finally {
    await cleanupFixtures(
      owner,
      [trip],
      customers.map((c) => c.id),
    );
    await owner.end();
  }
}, 30000);
