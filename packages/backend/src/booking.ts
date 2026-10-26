import { randomUUID } from 'node:crypto';
import type { Database, Transaction } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import { timed } from './telemetry';

type Result = { status: number; body: Record<string, unknown> };
export type HoldInput = {
  tripId: string;
  seatLabels: string[];
  expectedTotalMinor: number;
  currency: 'INR';
};
const failure = (code: string, detail: string, status = 409): Result => ({
  status,
  body: { code, detail },
});
const scope = 'POST /api/v1/holds';

async function expire(tx: Transaction, tripId: string, timestamp: string) {
  const due = await tx.execute<{ id: string }>(sql`
    UPDATE bookings SET status='EXPIRED'
    WHERE trip_id=${tripId} AND status='HELD' AND expires_at <= ${timestamp}::timestamptz RETURNING id`);
  for (const booking of due.rows) {
    await tx.execute(
      sql`DELETE FROM seat_allocations WHERE booking_id=${booking.id}`,
    );
    await tx.execute(
      sql`INSERT INTO booking_events(id,booking_id,type) VALUES(${randomUUID()},${booking.id},'EXPIRED')`,
    );
  }
}

// The trip row is the serialization boundary for every inventory mutation.
// Read clock_timestamp only AFTER acquiring it: transaction now() can be stale.
async function lockTrip(tx: Transaction, tripId: string) {
  await tx.execute(sql`SET LOCAL lock_timeout='2s'`);
  await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
  const trip = await timed('tripLock', () =>
    tx.execute<{
      sales_state: string;
      sales_close_at: string;
    }>(sql`
    SELECT sales_state,sales_close_at::text FROM trips WHERE id=${tripId} FOR UPDATE`),
  );
  if (!trip.rows[0]) return null;
  const clock = await tx.execute<{ timestamp: string }>(
    sql`SELECT clock_timestamp()::text AS timestamp`,
  );
  const timestamp = clock.rows[0].timestamp;
  await expire(tx, tripId, timestamp);
  return { ...trip.rows[0], timestamp };
}

async function idempotent(
  db: Database,
  userId: string,
  route: string,
  key: string,
  payload: unknown,
  operation: (tx: Transaction) => Promise<Result>,
) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const hash = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  return timed('command', () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout='2s'`);
      await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
      const claim = await tx.execute(sql`
      INSERT INTO idempotency_keys(principal_id,scope,key,request_hash) VALUES(${userId},${route},${key},${hash})
      ON CONFLICT DO NOTHING RETURNING key`);
      if (!claim.rowCount) {
        // A separate statement takes a fresh READ COMMITTED snapshot after a competing INSERT commits.
        const existing = await tx.execute<{
          request_hash: string;
          http_status: number;
          response: Record<string, unknown>;
        }>(sql`
        SELECT request_hash,http_status,response FROM idempotency_keys
        WHERE principal_id=${userId} AND scope=${route} AND key=${key}`);
        const saved = existing.rows[0];
        if (!saved || saved.http_status === null)
          throw new Error('Incomplete idempotency record');
        if (saved.request_hash !== hash)
          return failure(
            'IDEMPOTENCY_KEY_REUSED',
            'This request key was used for different details.',
            422,
          );
        return { status: saved.http_status, body: saved.response };
      }
      const result = await operation(tx);
      await tx.execute(sql`UPDATE idempotency_keys SET http_status=${result.status},response=${JSON.stringify(result.body)}::jsonb
      WHERE principal_id=${userId} AND scope=${route} AND key=${key}`);
      return result;
    }),
  );
}

export async function holdSeats(
  db: Database,
  userId: string,
  key: string,
  input: HoldInput,
) {
  const seats = [...input.seatLabels].sort();
  return idempotent(
    db,
    userId,
    scope,
    key,
    { ...input, seatLabels: seats },
    async (tx) => {
      const trip = await lockTrip(tx, input.tripId);
      if (!trip)
        return failure('TRIP_NOT_FOUND', 'This trip is unavailable.', 404);
      if (
        trip.sales_state !== 'OPEN' ||
        Date.parse(trip.sales_close_at) - Date.parse(trip.timestamp) < 120000
      ) {
        return failure(
          'SALES_CLOSED',
          'Reservations for this trip have closed.',
        );
      }
      const pending = await tx.execute(
        sql`SELECT id FROM bookings WHERE trip_id=${input.tripId} AND user_id=${userId} AND status='HELD'`,
      );
      if (pending.rowCount)
        return failure(
          'ACTIVE_HOLD_EXISTS',
          'You already have a reservation for this trip. Open My bookings.',
        );
      const selected = await tx.execute<{
        seat_label: string;
        fare_minor: number;
        occupied: boolean;
      }>(sql`
      SELECT s.seat_label,s.fare_minor,a.booking_id IS NOT NULL AS occupied
      FROM trip_seats s LEFT JOIN seat_allocations a USING(trip_id,seat_label)
      WHERE s.trip_id=${input.tripId} AND s.seat_label IN (${sql.join(
        seats.map((s) => sql`${s}`),
        sql`,`,
      )}) ORDER BY s.position`);
      if (selected.rowCount !== seats.length)
        return failure('INVALID_SEATS', 'Choose seats from this trip.', 422);
      if (selected.rows.some((s) => s.occupied))
        return failure(
          'SEATS_UNAVAILABLE',
          'Some seats were just reserved. Please choose again.',
        );
      const total = selected.rows.reduce((sum, s) => sum + s.fare_minor, 0);
      if (total !== input.expectedTotalMinor)
        return failure(
          'FARE_CHANGED',
          'The fare changed. Refresh before reserving.',
        );
      const id = randomUUID();
      const reference = `QB-${id.replaceAll('-', '').toUpperCase()}`;
      const expiresAt = new Date(
        Math.min(
          Date.parse(trip.timestamp) + 600000,
          Date.parse(trip.sales_close_at),
        ),
      ).toISOString();
      await tx.execute(sql`INSERT INTO bookings(id,trip_id,user_id,reference,total_minor,expires_at)
      VALUES(${id},${input.tripId},${userId},${reference},${total},${expiresAt})`);
      await tx.execute(sql`INSERT INTO booking_items(booking_id,trip_id,seat_label,fare_minor) VALUES
      ${sql.join(
        selected.rows.map(
          (s) => sql`(${id},${input.tripId},${s.seat_label},${s.fare_minor})`,
        ),
        sql`,`,
      )}`);
      // No conflict-ignore: the whole party either owns every seat or the transaction rolls back.
      await tx.execute(sql`INSERT INTO seat_allocations(trip_id,seat_label,booking_id) VALUES
      ${sql.join(
        seats.map((s) => sql`(${input.tripId},${s},${id})`),
        sql`,`,
      )}`);
      await tx.execute(
        sql`INSERT INTO booking_events(id,booking_id,type) VALUES(${randomUUID()},${id},'HELD')`,
      );
      return {
        status: 201,
        body: {
          id,
          tripId: input.tripId,
          reference,
          status: 'HELD',
          seatLabels: seats,
          totalMinor: total,
          currency: 'INR',
          expiresAt,
          serverTime: new Date(trip.timestamp).toISOString(),
        },
      };
    },
  );
}

export async function releaseHold(
  db: Database,
  userId: string,
  key: string,
  id: string,
) {
  return idempotent(
    db,
    userId,
    `POST /api/v1/bookings/${id}/release`,
    key,
    {},
    async (tx) => {
      const booking = await tx.execute<{ trip_id: string }>(
        sql`SELECT trip_id FROM bookings WHERE id=${id} AND user_id=${userId}`,
      );
      if (!booking.rows[0])
        return failure('BOOKING_NOT_FOUND', 'Reservation not found.', 404);
      await lockTrip(tx, booking.rows[0].trip_id);
      const changed = await tx.execute(
        sql`UPDATE bookings SET status='CANCELLED' WHERE id=${id} AND status='HELD' RETURNING id`,
      );
      if (changed.rowCount) {
        await tx.execute(
          sql`DELETE FROM seat_allocations WHERE booking_id=${id}`,
        );
        await tx.execute(
          sql`INSERT INTO booking_events(id,booking_id,type) VALUES(${randomUUID()},${id},'CANCELLED')`,
        );
      }
      return { status: 200, body: { id, released: true } };
    },
  );
}

export async function listTrips(db: Database) {
  const result =
    await db.execute(sql`SELECT t.id,t.origin,t.destination,t.operator_name AS "operatorName",
    t.departure_at AS "departureAt",t.arrival_at AS "arrivalAt",min(s.fare_minor)::int AS "fareMinor",count(s.seat_label)::int AS "seatCount"
    FROM trips t JOIN trip_seats s ON s.trip_id=t.id WHERE t.sales_state='OPEN' AND t.sales_close_at>clock_timestamp()+interval '2 minutes'
    GROUP BY t.id ORDER BY t.departure_at LIMIT 100`);
  return result.rows;
}

export async function listSeats(db: Database, tripId: string) {
  const result =
    await db.execute(sql`SELECT s.seat_label AS label,s.position,s.fare_minor AS "fareMinor",
    (b.id IS NULL OR b.status<>'HELD' OR b.expires_at<=clock_timestamp()) AS available
    FROM trip_seats s LEFT JOIN seat_allocations a USING(trip_id,seat_label) LEFT JOIN bookings b ON b.id=a.booking_id
    WHERE s.trip_id=${tripId} ORDER BY s.position`);
  return result.rows;
}

export async function getBookings(db: Database, userId: string, id?: string) {
  const result =
    await db.execute(sql`SELECT b.id,b.trip_id AS "tripId",b.reference,
    CASE WHEN b.status='HELD' AND b.expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE b.status END AS status,
    b.expires_at AS "expiresAt",b.total_minor AS "totalMinor",b.currency,t.origin,t.destination,t.departure_at AS "departureAt",
    ARRAY(SELECT seat_label FROM booking_items WHERE booking_id=b.id ORDER BY seat_label) AS "seatLabels",clock_timestamp() AS "serverTime"
    FROM bookings b JOIN trips t ON t.id=b.trip_id WHERE b.user_id=${userId} ${id ? sql`AND b.id=${id}` : sql``}
    ORDER BY b.created_at DESC LIMIT 25`);
  return result.rows;
}
