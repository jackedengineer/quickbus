import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

export function renewalQuery(days = 30, batch = 5) {
  if (
    !Number.isInteger(days) ||
    days < 1 ||
    days > 30 ||
    !Number.isInteger(batch) ||
    batch < 1 ||
    batch > 5
  )
    throw new Error('Inventory renewal bounds exceeded.');
  return sql`
    WITH clock AS (SELECT (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date today), invalid AS (
      SELECT s.id FROM inventory_services s LEFT JOIN inventory_service_seats seats ON seats.service_id=s.id
      WHERE s.active GROUP BY s.id HAVING count(seats.label)<>s.seat_count OR min(seats.position)<>1 OR max(seats.position)<>s.seat_count
    ), candidates AS (
      SELECT s.*, ((clock.today + d.day) + s.departure_local_time) AT TIME ZONE 'Asia/Kolkata' AS departure
      FROM inventory_services s CROSS JOIN clock CROSS JOIN generate_series(1,${days}) AS d(day)
      WHERE s.active AND NOT EXISTS(SELECT 1 FROM invalid)
    ), missing AS (
      SELECT c.* FROM candidates c WHERE NOT EXISTS (
        SELECT 1 FROM trips t WHERE t.source_service_id=c.id AND t.departure_at=c.departure
      ) ORDER BY c.departure,c.id LIMIT ${batch}
    ), published AS (
      INSERT INTO trips(id,origin,destination,operator_name,source_service_id,vehicle_label,departure_at,arrival_at,sales_close_at)
      SELECT gen_random_uuid(),origin,destination,operator_name,id,vehicle_label,departure,
        departure+travel_minutes*interval '1 minute',departure-sales_lead_minutes*interval '1 minute' FROM missing
      ON CONFLICT(source_service_id,departure_at) DO NOTHING RETURNING id,source_service_id
    ), copied AS (
      INSERT INTO trip_seats(trip_id,seat_label,position,fare_minor)
      SELECT p.id,s.label,s.position,s.fare_minor FROM published p JOIN inventory_service_seats s ON s.service_id=p.source_service_id RETURNING trip_id
    ) SELECT (SELECT count(*)::int FROM published) AS created,
      (SELECT count(*)::int FROM invalid) AS invalid,
      (SELECT count(*)::int FROM copied) AS seats`;
}
export function renewalPgQuery(days: number) {
  return new PgDialect().sqlToQuery(renewalQuery(days));
}
