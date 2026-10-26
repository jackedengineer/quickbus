import { randomUUID } from 'node:crypto';
import type { Database } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import { failure, idempotent, lockTrip, validStops } from './commands';
import { isoInstant } from './presentation';

export type HoldInput = {
  tripId: string;
  seatLabels: string[];
  expectedTotalMinor: number;
  currency: 'INR';
  pickupStopId?: string;
  dropStopId?: string;
};
const scope = 'POST /api/v1/holds';

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
      if (
        input.pickupStopId &&
        input.dropStopId &&
        !(await validStops(
          tx,
          input.tripId,
          input.pickupStopId,
          input.dropStopId,
        ))
      )
        return failure(
          'INVALID_STOPS',
          'Choose pickup and drop locations for this journey.',
          422,
        );
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
      await tx.execute(sql`INSERT INTO bookings(id,trip_id,user_id,reference,total_minor,expires_at,pickup_stop_id,drop_stop_id)
      VALUES(${id},${input.tripId},${userId},${reference},${total},${expiresAt},${input.pickupStopId ?? null},${input.dropStopId ?? null})`);
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
    await db.execute(sql`SELECT t.id,t.origin,t.destination,t.operator_name AS "operatorName",t.vehicle_label AS "vehicleLabel",
    t.departure_at AS "departureAt",t.arrival_at AS "arrivalAt",min(s.fare_minor)::int AS "fareMinor",count(s.seat_label)::int AS "seatCount"
    FROM trips t JOIN trip_seats s ON s.trip_id=t.id WHERE t.sales_state='OPEN' AND t.sales_close_at>clock_timestamp()+interval '2 minutes'
    GROUP BY t.id ORDER BY t.departure_at LIMIT 100`);
  return result.rows.map((t) => ({
    ...t,
    departureAt: isoInstant(t.departureAt),
    arrivalAt: isoInstant(t.arrivalAt),
  }));
}

export async function listSeats(db: Database, tripId: string) {
  const result =
    await db.execute(sql`SELECT s.seat_label AS label,s.position,s.fare_minor AS "fareMinor",
    (b.id IS NULL OR b.status<>'HELD' OR b.expires_at<=statement_timestamp()) AS available
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
  return result.rows.map((b) => ({
    ...b,
    departureAt: isoInstant(b.departureAt),
    expiresAt: isoInstant(b.expiresAt),
    serverTime: isoInstant(b.serverTime),
  }));
}
