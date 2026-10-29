import { randomUUID } from 'node:crypto';
import type {
  ReservationDetailsInput,
  ReservationReview,
} from '@kwikbus/contracts';
import type { Database } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import { failure, idempotent, lockTrip, validStops } from './commands';
import { isoInstant } from './presentation';

export async function saveReservationDetails(
  db: Database,
  userId: string,
  id: string,
  key: string,
  version: number,
  input: ReservationDetailsInput,
) {
  const passengers = [...input.passengers].sort((a, b) =>
    a.seatLabel.localeCompare(b.seatLabel),
  );
  return idempotent(
    db,
    userId,
    `PATCH /api/v1/bookings/${id}/details`,
    key,
    { version, ...input, passengers },
    async (tx) => {
      const found = await tx.execute<{ trip_id: string }>(
        sql`SELECT trip_id FROM bookings WHERE id=${id} AND user_id=${userId}`,
      );
      if (!found.rows[0])
        return failure('BOOKING_NOT_FOUND', 'Reservation not found.', 404);
      const trip = await lockTrip(tx, found.rows[0].trip_id);
      if (!trip)
        return failure('BOOKING_NOT_FOUND', 'Reservation not found.', 404);
      const current = await tx.execute<{ status: string; version: number }>(
        sql`SELECT status,version FROM bookings WHERE id=${id} AND user_id=${userId}`,
      );
      if (current.rows[0].status !== 'HELD')
        return failure(
          'RESERVATION_ENDED',
          'This reservation has ended. Start a new search.',
        );
      if (current.rows[0].version !== version)
        return failure(
          'VERSION_CONFLICT',
          'Details changed in another tab. Reload the saved version before editing.',
          412,
        );
      if (
        !(await validStops(
          tx,
          found.rows[0].trip_id,
          input.pickupStopId,
          input.dropStopId,
        ))
      )
        return failure(
          'INVALID_STOPS',
          'Choose pickup and drop locations for this journey.',
          422,
        );
      const items = await tx.execute<{ seat_label: string }>(
        sql`SELECT seat_label FROM booking_items WHERE booking_id=${id} ORDER BY seat_label`,
      );
      if (
        items.rows.length !== passengers.length ||
        items.rows.some(
          (p) => !passengers.some((i) => i.seatLabel === p.seat_label),
        )
      )
        return failure(
          'PASSENGER_SEATS_MISMATCH',
          'Enter one passenger for every reserved seat.',
          422,
        );
      const account = await tx.execute<{ email: string }>(
        sql`SELECT email FROM "user" WHERE id=${userId} AND email_verified`,
      );
      if (!account.rows[0])
        return failure(
          'SIGN_IN_REQUIRED',
          'Sign in with a verified account.',
          401,
        );
      await tx.execute(sql`UPDATE bookings SET pickup_stop_id=${input.pickupStopId},drop_stop_id=${input.dropStopId},
      contact_email=${account.rows[0].email},contact_phone=${input.contactPhone},version=version+1 WHERE id=${id}`);
      for (const passenger of passengers)
        await tx.execute(sql`UPDATE booking_items SET passenger_name=${passenger.name}
      WHERE booking_id=${id} AND seat_label=${passenger.seatLabel}`);
      await tx.execute(
        sql`INSERT INTO booking_events(id,booking_id,type,version) VALUES(${randomUUID()},${id},'DETAILS_SAVED',${version + 1})`,
      );
      return {
        status: 200,
        body: { id, version: version + 1, complete: true },
      };
    },
  );
}
export async function reservationReview(
  db: Database,
  userId: string,
  id: string,
) {
  // One statement snapshot keeps version, names and lifecycle status consistent.
  const result =
    await db.execute<ReservationReview>(sql`SELECT b.id,b.trip_id AS "tripId",b.reference,b.version,
    EXISTS(SELECT 1 FROM booking_events WHERE booking_id=b.id AND type='CONFIRMED') AS "wasConfirmed",
    (SELECT state FROM booking_notifications WHERE booking_id=b.id AND kind='CONFIRMED') AS "confirmationEmail",
    CASE WHEN b.status IN ('HELD','PAYMENT_PENDING') AND b.expires_at<=statement_timestamp() THEN 'EXPIRED' ELSE b.status END status,
    b.expires_at AS "expiresAt",statement_timestamp() AS "serverTime",b.total_minor AS "totalMinor",b.currency,
    t.origin,t.destination,t.departure_at AS "departureAt",t.arrival_at AS "arrivalAt",t.operator_name AS "operatorName",t.vehicle_label AS "vehicleLabel",
    b.pickup_stop_id AS "pickupStopId",b.drop_stop_id AS "dropStopId",coalesce(b.contact_email,u.email) AS "contactEmail",b.contact_phone AS "contactPhone",
    ARRAY(SELECT seat_label FROM booking_items WHERE booking_id=b.id ORDER BY seat_label) AS "seatLabels",
    (SELECT jsonb_agg(jsonb_build_object('seatLabel',seat_label,'fareMinor',fare_minor,'name',passenger_name) ORDER BY seat_label)
      FROM booking_items WHERE booking_id=b.id) passengers,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'address',address,'cityId',city_id,'role',role,'sequence',sequence,'scheduledAt',scheduled_at) ORDER BY sequence)
      FROM trip_stops WHERE trip_id=b.trip_id),'[]'::jsonb) stops,
    b.pickup_stop_id IS NOT NULL AND b.drop_stop_id IS NOT NULL AND b.contact_email IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM booking_items WHERE booking_id=b.id AND passenger_name IS NULL) complete
    FROM bookings b JOIN trips t ON t.id=b.trip_id JOIN "user" u ON u.id=b.user_id WHERE b.id=${id} AND b.user_id=${userId}`);
  const row = result.rows[0];
  return row
    ? {
        ...row,
        departureAt: isoInstant(row.departureAt),
        arrivalAt: isoInstant(row.arrivalAt),
        expiresAt: isoInstant(row.expiresAt),
        serverTime: isoInstant(row.serverTime),
        stops: row.stops.map((s) => ({
          ...s,
          scheduledAt: isoInstant(s.scheduledAt),
        })),
      }
    : null;
}
