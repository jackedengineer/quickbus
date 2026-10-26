import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import type { SearchPage } from '../../packages/contracts/src';
import {
  cleanupFixtures,
  createCustomers,
  createTrip,
  fixtureClient,
} from '../support/fixtures';

test('server search resolves aliases, binds cursors and filters actual live capacity', async () => {
  const owner = await fixtureClient(),
    customers = await createCustomers(owner, 1),
    ids: string[] = [];
  const origin = process.env.APP_ORIGIN ?? 'http://localhost:3000';
  const date = (
    await owner.query(
      "SELECT ((clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date+2)::text date",
    )
  ).rows[0].date;
  const params = new URLSearchParams({
    from: 'Bangalore',
    to: 'Hyderabad',
    date,
    adults: '2',
    limit: '1',
  });
  const search = async (query = params) => {
    const response = await fetch(`${origin}/api/v1/trips?${query}`);
    return {
      status: response.status,
      body: (await response.json()) as SearchPage,
    };
  };
  try {
    for (let n = 0; n < 2; n++) {
      const id = await createTrip(owner);
      ids.push(id);
      await owner.query(
        `UPDATE trips SET route_id='bengaluru-hyderabad',origin_city_id='bengaluru',destination_city_id='hyderabad',operator_id='kwikbus-demo',
        departure_at=($2::date+make_time($3,0,0)) AT TIME ZONE 'Asia/Kolkata',arrival_at=($2::date+make_time($3,0,0)) AT TIME ZONE 'Asia/Kolkata'+interval '10 hours',
        sales_close_at=($2::date+make_time($3,0,0)) AT TIME ZONE 'Asia/Kolkata'-interval '30 minutes' WHERE id=$1`,
        [id, date, 12 + n],
      );
      await owner.query(
        `INSERT INTO trip_stops(id,trip_id,source_stop_id,city_id,name,address,role,sequence,scheduled_at)
        SELECT gen_random_uuid(),$1,st.id,st.city_id,st.name,st.address,d.role,d.sequence,t.departure_at+d.offset_minutes*interval '1 minute'
        FROM trips t,inventory_service_stops d JOIN stops st ON st.id=d.stop_id WHERE t.id=$1 AND d.service_id='demo-blr-hyd-20'`,
        [id],
      );
      await owner.query(
        'UPDATE trip_seats SET fare_minor=$2 WHERE trip_id=$1',
        [id, 50000 + n * 100],
      );
    }
    const first = await search();
    expect(first.status).toBe(200);
    expect(first.body.trips.map((t) => t.id)).toEqual([ids[0]]);
    expect(first.body.nextCursor).toBeTruthy();
    const next = new URLSearchParams(params);
    next.set('cursor', first.body.nextCursor ?? '');
    expect((await search(next)).body.trips[0].id).toBe(ids[1]);
    next.set('adults', '3');
    expect((await search(next)).status).toBe(400);
    const price = new URLSearchParams(params);
    price.set('sort', 'price');
    expect((await search(price)).body.trips[0].id).toBe(ids[0]);
    const held = await fetch(`${origin}/api/v1/holds`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: customers[0].cookie,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({
        tripId: ids[0],
        seatLabels: ['1A', '1B'],
        expectedTotalMinor: 100000,
        currency: 'INR',
      }),
    });
    expect(held.status).toBe(201);
    expect((await search()).body.trips[0].id).toBe(ids[1]);
    const one = new URLSearchParams(params);
    one.set('adults', '1');
    const available = await search(one);
    expect(available.body.trips[0]).toMatchObject({
      id: ids[0],
      availableSeats: 1,
    });
    const cases = [
      { from: 'Unknown city' },
      { to: 'Bengaluru' },
      { date: '2026-02-30' },
      { adults: '5' },
      { cursor: 'bad!' },
    ];
    for (const input of cases) {
      const q = new URLSearchParams(params);
      for (const [key, value] of Object.entries(input)) q.set(key, value);
      expect((await search(q)).status).toBe(400);
    }
    const empty = new URLSearchParams(params);
    empty.set('to', 'Mumbai');
    expect((await search(empty)).body.trips).toEqual([]);
    expect((await fetch(`${origin}/api/v1/trips`)).ok).toBe(true); // bounded V0 read remains compatible
  } finally {
    await cleanupFixtures(
      owner,
      ids,
      customers.map((c) => c.id),
    );
    await owner.end();
  }
});
