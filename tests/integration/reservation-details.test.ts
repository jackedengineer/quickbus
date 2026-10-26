import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import type { ReservationReview } from '../../packages/contracts/src';
import {
  cleanupFixtures,
  createCustomers,
  createTrip,
  fixtureClient,
} from '../support/fixtures';

test('owned passenger review serializes edits, replays the same intent and rejects expiry/cross-trip stops', async () => {
  const owner = await fixtureClient();
  const customers = await createCustomers(owner, 2),
    ids: string[] = [];
  const origin = process.env.APP_ORIGIN ?? 'http://localhost:3000';
  const call = (
    path: string,
    method = 'GET',
    body?: unknown,
    extra: Record<string, string> = {},
    customer = customers[0],
  ) =>
    fetch(`${origin}/api/v1${path}`, {
      method,
      headers: {
        Origin: origin,
        Cookie: customer.cookie,
        'Content-Type': 'application/json',
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    for (let n = 0; n < 2; n++) {
      const id = await createTrip(owner);
      ids.push(id);
      await owner.query(
        `INSERT INTO trip_stops(id,trip_id,source_stop_id,city_id,name,address,role,sequence,scheduled_at)
        SELECT gen_random_uuid(),$1,st.id,st.city_id,st.name,st.address,d.role,d.sequence,t.departure_at+d.offset_minutes*interval '1 minute'
        FROM trips t,inventory_service_stops d JOIN stops st ON st.id=d.stop_id WHERE t.id=$1 AND d.service_id='demo-blr-hyd-20'`,
        [id],
      );
    }
    const stops = (
      await owner.query(
        'SELECT id,role FROM trip_stops WHERE trip_id=$1 ORDER BY sequence',
        [ids[0]],
      )
    ).rows;
    const pickupStopId = stops[0].id,
      dropStopId = stops[3].id;
    const held = await call(
      '/holds',
      'POST',
      {
        tripId: ids[0],
        seatLabels: ['1A', '1B'],
        expectedTotalMinor: 149800,
        currency: 'INR',
        pickupStopId,
        dropStopId,
      },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(held.status).toBe(201);
    const booking = (await held.json()) as { id: string; expiresAt: string };
    const path = `/bookings/${booking.id}`;
    const body = {
      pickupStopId,
      dropStopId,
      contactPhone: '+919876543210',
      passengers: [
        { seatLabel: '1A', name: 'Demo Traveller' },
        { seatLabel: '1B', name: 'नमूना यात्री' },
      ],
    };
    expect((await call(path, 'GET', undefined, {}, customers[1])).status).toBe(
      404,
    );
    expect(
      (
        await call(`${path}/details`, 'PATCH', body, {
          'Idempotency-Key': randomUUID(),
        })
      ).status,
    ).toBe(428);
    expect(
      (
        await call(
          `${path}/details`,
          'PATCH',
          { ...body, contactEmail: 'attacker@example.test' },
          { 'Idempotency-Key': randomUUID(), 'If-Match': '"1"' },
        )
      ).status,
    ).toBe(400);
    const key = randomUUID(),
      headers = { 'Idempotency-Key': key, 'If-Match': '"1"' };
    const results = await Promise.all([
      call(`${path}/details`, 'PATCH', body, headers),
      call(`${path}/details`, 'PATCH', body, headers),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const saved = (await (await call(path)).json()) as ReservationReview;
    expect(saved).toMatchObject({
      version: 2,
      complete: true,
      expiresAt: booking.expiresAt,
      pickupStopId,
      dropStopId,
    });
    expect(saved.passengers.map((p) => p.name)).toEqual(
      body.passengers.map((p) => p.name),
    );
    expect(saved.contactEmail).toBe(`${customers[0].id}@quickbus.test`);
    expect(
      (
        await call(
          `${path}/details`,
          'PATCH',
          { ...body, contactPhone: null },
          headers,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await call(`${path}/details`, 'PATCH', body, {
          'Idempotency-Key': randomUUID(),
          'If-Match': '"1"',
        })
      ).status,
    ).toBe(412);
    const foreign = (
      await owner.query(
        "SELECT id FROM trip_stops WHERE trip_id=$1 AND role='DROP' LIMIT 1",
        [ids[1]],
      )
    ).rows[0].id;
    expect(
      (
        await call(
          `${path}/details`,
          'PATCH',
          { ...body, dropStopId: foreign },
          { 'Idempotency-Key': randomUUID(), 'If-Match': '"2"' },
        )
      ).status,
    ).toBe(422);
    const race = await Promise.all(
      [null, '+919999999999'].map((contactPhone) =>
        call(
          `${path}/details`,
          'PATCH',
          { ...body, contactPhone },
          { 'Idempotency-Key': randomUUID(), 'If-Match': '"2"' },
        ),
      ),
    );
    expect(race.map((r) => r.status).sort()).toEqual([200, 412]);
    expect(
      (
        await owner.query(
          "SELECT count(*)::int n FROM booking_events WHERE booking_id=$1 AND type='DETAILS_SAVED'",
          [booking.id],
        )
      ).rows[0].n,
    ).toBe(2);
    await owner.query(
      "UPDATE bookings SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [booking.id],
    );
    expect(
      (
        await call(`${path}/details`, 'PATCH', body, {
          'Idempotency-Key': randomUUID(),
          'If-Match': '"3"',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await owner.query(
          'SELECT count(*)::int n FROM seat_allocations WHERE booking_id=$1',
          [booking.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect((await call(`${path}/details`, 'PATCH', body, headers)).status).toBe(
      200,
    ); // original result, no resurrection
    expect(
      ((await (await call(path)).json()) as ReservationReview).status,
    ).toBe('EXPIRED');
  } finally {
    await cleanupFixtures(
      owner,
      ids,
      customers.map((c) => c.id),
    );
    await owner.end();
  }
});

test('detail edits racing release across Workers cannot retain seat ownership or half-save details', async () => {
  const owner = await fixtureClient(),
    [customer] = await createCustomers(owner, 1),
    trip = await createTrip(owner);
  const origin = process.env.APP_ORIGIN ?? 'http://localhost:3000';
  const call = (
    endpoint: string,
    path: string,
    method: string,
    body: unknown,
    key = randomUUID(),
    version?: number,
  ) =>
    fetch(`${endpoint}/api/v1${path}`, {
      method,
      headers: {
        Origin: origin,
        Cookie: customer.cookie,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
        ...(version ? { 'If-Match': `"${version}"` } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    await owner.query(
      `INSERT INTO trip_stops(id,trip_id,source_stop_id,city_id,name,address,role,sequence,scheduled_at)
      SELECT gen_random_uuid(),$1,st.id,st.city_id,st.name,st.address,d.role,d.sequence,t.departure_at+d.offset_minutes*interval '1 minute'
      FROM trips t,inventory_service_stops d JOIN stops st ON st.id=d.stop_id WHERE t.id=$1 AND d.service_id='demo-blr-hyd-20'`,
      [trip],
    );
    const stops = (
      await owner.query(
        'SELECT id,role FROM trip_stops WHERE trip_id=$1 ORDER BY sequence',
        [trip],
      )
    ).rows;
    const held = await call(origin, '/holds', 'POST', {
      tripId: trip,
      seatLabels: ['1A'],
      expectedTotalMinor: 74900,
      currency: 'INR',
    });
    expect(held.status).toBe(201);
    const id = ((await held.json()) as { id: string }).id;
    const body = {
      pickupStopId: stops[0].id,
      dropStopId: stops[3].id,
      contactPhone: null,
      passengers: [{ seatLabel: '1A', name: 'Release race fixture' }],
    };
    const badOrigin = await fetch(`${origin}/api/v1/bookings/${id}/details`, {
      method: 'PATCH',
      headers: {
        Origin: 'https://untrusted.invalid',
        Cookie: customer.cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    expect(badOrigin.status).toBe(403);
    const huge = await fetch(`${origin}/api/v1/bookings/${id}/details`, {
      method: 'PATCH',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ unused: 'x'.repeat(17000) }),
    });
    expect(huge.status).toBe(413);
    const key = randomUUID();
    const [saved, released] = await Promise.all([
      call(
        'http://localhost:8787',
        `/bookings/${id}/details`,
        'PATCH',
        body,
        key,
        1,
      ),
      call('http://localhost:8788', `/bookings/${id}/release`, 'POST', {}),
    ]);
    expect([200, 409]).toContain(saved.status);
    expect(released.status).toBe(200);
    const audit = (
      await owner.query(
        `SELECT b.status,b.version,b.contact_email IS NOT NULL contact,
      (SELECT count(*)::int FROM seat_allocations WHERE booking_id=b.id) allocations,
      (SELECT count(*)::int FROM booking_items WHERE booking_id=b.id AND passenger_name IS NOT NULL) names,
      (SELECT count(*)::int FROM booking_events WHERE booking_id=b.id AND type='DETAILS_SAVED') events FROM bookings b WHERE id=$1`,
        [id],
      )
    ).rows[0];
    expect(audit).toMatchObject({ status: 'CANCELLED', allocations: 0 });
    expect(audit.names).toBe(audit.events);
    expect(audit.version).toBe(1 + audit.events);
    expect(audit.contact).toBe(Boolean(audit.events));
    expect(
      (await call(origin, `/bookings/${id}/details`, 'PATCH', body, key, 1))
        .status,
    ).toBe(saved.status);
  } finally {
    await cleanupFixtures(owner, [trip], [customer.id]);
    await owner.end();
  }
});
