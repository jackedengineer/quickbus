import { Buffer } from 'node:buffer';
import type {
  Catalog,
  SearchInput,
  SearchPage,
  Trip,
  TripStop,
} from '@kwikbus/contracts';
import type { Database } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import { z } from 'zod';
import { isoInstant } from './presentation';

export async function citySuggestions(db: Database, query: string) {
  return (
    await db.execute<{ id: string; name: string }>(sql`
    SELECT c.id,c.name FROM cities c WHERE EXISTS(SELECT 1 FROM city_aliases a WHERE a.city_id=c.id
    AND starts_with(a.alias,lower(${query.trim()}))) ORDER BY c.name LIMIT 20`)
  ).rows;
}
export async function catalog(db: Database): Promise<Catalog> {
  const [cities, dates, first] = await Promise.all([
    citySuggestions(db, ''),
    db.execute<{ today: string; through: string }>(sql`SELECT
      (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date::text today,
      ((statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date+30)::text through`),
    db.execute<{
      from: string;
      to: string;
      date: string;
    }>(sql`SELECT origin AS "from",destination AS "to",
      (departure_at AT TIME ZONE 'Asia/Kolkata')::date::text date FROM trips t
      WHERE sales_state='OPEN' AND sales_close_at>statement_timestamp()+interval '2 minutes'
      AND route_id IS NOT NULL AND EXISTS(SELECT 1 FROM trip_stops WHERE trip_id=t.id)
      ORDER BY departure_at,id LIMIT 1`),
  ]);
  return { cities, ...dates.rows[0], defaults: first.rows[0] ?? null };
}
const cursorSchema = z
  .object({
    v: z.literal(1),
    filter: z.string().max(700),
    id: z.uuid(),
    at: z.iso.datetime(),
    price: z.number().int().positive(),
  })
  .strict();
const bad = (code: string, detail: string) => ({
  status: 400,
  body: { trips: [], code, detail },
});
export async function searchTrips(
  db: Database,
  input: SearchInput,
): Promise<{ status: number; body: SearchPage }> {
  const resolved = await db.execute<{
    id: string;
    alias: string;
  }>(sql`SELECT city_id id,alias FROM city_aliases
    WHERE alias IN (lower(${input.from}),lower(${input.to}))`);
  const origin = resolved.rows.find(
    (c) => c.alias === input.from.toLowerCase(),
  )?.id;
  const destination = resolved.rows.find(
    (c) => c.alias === input.to.toLowerCase(),
  )?.id;
  if (!origin || !destination)
    return bad('UNKNOWN_CITY', 'Choose a city from the suggestions.');
  if (origin === destination)
    return bad('SAME_CITY', 'Choose two different cities.');
  const range = await db.execute<{
    valid: boolean;
  }>(sql`SELECT ${input.date}::date BETWEEN
    (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date AND
    (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date+30 valid`);
  if (!range.rows[0].valid)
    return bad('DATE_OUT_OF_RANGE', 'Choose a date within the next 30 days.');
  const filter = JSON.stringify([
    origin,
    destination,
    input.date,
    input.adults,
    input.sort,
    input.limit,
  ]);
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (input.cursor) {
    try {
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')),
      );
    } catch {
      return bad(
        'INVALID_CURSOR',
        'This page link is invalid. Start a new search.',
      );
    }
    if (cursor.filter !== filter)
      return bad(
        'INVALID_CURSOR',
        'Search filters changed. Start from the first page.',
      );
  }
  const after = !cursor
    ? sql`true`
    : input.sort === 'price'
      ? sql`(q."fareMinor",q.id)>(${cursor.price},${cursor.id}::uuid)`
      : sql`(q."departureAt"::timestamptz,q.id)>(${cursor.at}::timestamptz,${cursor.id}::uuid)`;
  const order =
    input.sort === 'price'
      ? sql`q."fareMinor",q.id`
      : sql`q."departureAt"::timestamptz,q.id`;
  const result = await db.execute<Trip>(sql`WITH candidates AS (
    SELECT t.* FROM trips t WHERE origin_city_id=${origin} AND destination_city_id=${destination}
    AND departure_at>=(${input.date}::date::timestamp AT TIME ZONE 'Asia/Kolkata')
    AND departure_at< ((${input.date}::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata')
    AND sales_state='OPEN' AND sales_close_at>statement_timestamp()+interval '2 minutes'
    AND EXISTS(SELECT 1 FROM trip_stops WHERE trip_id=t.id)
  ), availability AS (
    SELECT t.id,s.seat_label,s.fare_minor,
      b.id IS NULL OR b.status IN ('EXPIRED','CANCELLED') OR (b.status IN ('HELD','PAYMENT_PENDING') AND b.expires_at<=statement_timestamp()) available
    FROM candidates t JOIN trip_seats s ON s.trip_id=t.id
    LEFT JOIN seat_allocations a USING(trip_id,seat_label) LEFT JOIN bookings b ON b.id=a.booking_id
  ), q AS (
    SELECT t.id,t.origin,t.destination,t.operator_name AS "operatorName",t.vehicle_label AS "vehicleLabel",
      to_char(t.departure_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "departureAt",
      t.arrival_at AS "arrivalAt",min(a.fare_minor) FILTER(WHERE a.available)::int AS "fareMinor",
      count(*)::int AS "seatCount",count(*) FILTER(WHERE a.available)::int AS "availableSeats"
    FROM candidates t JOIN availability a ON a.id=t.id GROUP BY t.id,t.origin,t.destination,t.operator_name,t.vehicle_label,t.departure_at,t.arrival_at
    HAVING count(*) FILTER(WHERE a.available)>=${input.adults}
  ) SELECT * FROM q WHERE ${after} ORDER BY ${order} LIMIT ${input.limit + 1}`);
  const trips = result.rows
      .slice(0, input.limit)
      .map((t) => ({ ...t, arrivalAt: isoInstant(t.arrivalAt) })),
    last = trips.at(-1);
  return {
    status: 200,
    body: {
      trips,
      nextCursor:
        result.rows.length > input.limit && last
          ? Buffer.from(
              JSON.stringify({
                v: 1,
                filter,
                id: last.id,
                at: last.departureAt,
                price: last.fareMinor,
              }),
            ).toString('base64url')
          : undefined,
    },
  };
}
export async function tripDetails(db: Database, id: string) {
  const result =
    await db.execute<Trip>(sql`SELECT t.id,t.origin,t.destination,t.operator_name AS "operatorName",t.vehicle_label AS "vehicleLabel",
    t.departure_at AS "departureAt",t.arrival_at AS "arrivalAt",min(s.fare_minor)::int AS "fareMinor",count(*)::int AS "seatCount"
    FROM trips t JOIN trip_seats s ON s.trip_id=t.id WHERE t.id=${id} AND t.sales_state='OPEN' AND t.sales_close_at>statement_timestamp()+interval '2 minutes' GROUP BY t.id`);
  if (!result.rows[0]) return null;
  const stops =
    await db.execute<TripStop>(sql`SELECT id,name,address,city_id AS "cityId",role,sequence,scheduled_at AS "scheduledAt"
    FROM trip_stops WHERE trip_id=${id} ORDER BY sequence`);
  return {
    ...result.rows[0],
    departureAt: isoInstant(result.rows[0].departureAt),
    arrivalAt: isoInstant(result.rows[0].arrivalAt),
    stops: stops.rows.map((s) => ({
      ...s,
      scheduledAt: isoInstant(s.scheduledAt),
    })),
  };
}
