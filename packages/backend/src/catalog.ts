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
  // The invocation pool has one connection. Promise.all would still serialize
  // three network round trips; return a coherent catalog in one statement.
  const result = await db.execute<Catalog>(sql`SELECT
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) ORDER BY c.name)
      FROM (SELECT id,name FROM cities c WHERE EXISTS(SELECT 1 FROM city_aliases a WHERE a.city_id=c.id) ORDER BY name LIMIT 20) c),'[]'::jsonb) cities,
    (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date::text today,
    ((statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date+30)::text through,
    (SELECT jsonb_build_object('from',origin,'to',destination,'date',(departure_at AT TIME ZONE 'Asia/Kolkata')::date::text)
      FROM trips t WHERE sales_state='OPEN' AND sales_close_at>statement_timestamp()+interval '2 minutes'
      AND route_id IS NOT NULL AND EXISTS(SELECT 1 FROM trip_stops WHERE trip_id=t.id)
      ORDER BY departure_at,id LIMIT 1) defaults`);
  return result.rows[0];
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
    origin: string | null;
    destination: string | null;
    valid: boolean;
  }>(sql`SELECT
    (SELECT city_id FROM city_aliases WHERE alias=lower(${input.from})) origin,
    (SELECT city_id FROM city_aliases WHERE alias=lower(${input.to})) destination,
    ${input.date}::date BETWEEN (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
      AND (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date+30 valid`);
  const { origin, destination, valid } = resolved.rows[0];
  if (!origin || !destination)
    return bad('UNKNOWN_CITY', 'Choose a city from the suggestions.');
  if (origin === destination)
    return bad('SAME_CITY', 'Choose two different cities.');
  if (!valid)
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
