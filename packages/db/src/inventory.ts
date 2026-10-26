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
      SELECT s.id FROM inventory_services s WHERE s.active AND (
        (SELECT count(*) FROM inventory_service_seats seats WHERE seats.service_id=s.id)<>s.seat_count
        OR (SELECT min(position) FROM inventory_service_seats WHERE service_id=s.id)<>1
        OR (SELECT max(position) FROM inventory_service_seats WHERE service_id=s.id)<>s.seat_count
        OR ((s.route_id IS NOT NULL OR s.operator_id IS NOT NULL OR s.layout_id IS NOT NULL) AND (
          s.route_id IS NULL OR s.operator_id IS NULL OR s.layout_id IS NULL
          OR s.seat_count<>(SELECT seat_count FROM layouts WHERE id=s.layout_id)
          OR (SELECT count(*) FROM layout_seats WHERE layout_id=s.layout_id)<>s.seat_count
          OR EXISTS(SELECT 1 FROM inventory_service_seats ss WHERE ss.service_id=s.id AND NOT EXISTS(
            SELECT 1 FROM layout_seats ls WHERE ls.layout_id=s.layout_id AND ls.label=ss.label AND ls.position=ss.position))
          OR NOT EXISTS(SELECT 1 FROM inventory_service_stops WHERE service_id=s.id AND role='PICKUP' AND offset_minutes=0)
          OR NOT EXISTS(SELECT 1 FROM inventory_service_stops WHERE service_id=s.id AND role='DROP' AND offset_minutes=s.travel_minutes)
          OR (SELECT max(sequence) FROM inventory_service_stops WHERE service_id=s.id AND role='PICKUP') >=
             (SELECT min(sequence) FROM inventory_service_stops WHERE service_id=s.id AND role='DROP')
          OR EXISTS(SELECT 1 FROM inventory_service_stops d JOIN stops st ON st.id=d.stop_id JOIN routes r ON r.id=s.route_id
            WHERE d.service_id=s.id AND (d.offset_minutes>s.travel_minutes OR st.city_id<>CASE WHEN d.role='PICKUP' THEN r.origin_city_id ELSE r.destination_city_id END))
          OR EXISTS(SELECT 1 FROM (SELECT offset_minutes,lag(offset_minutes) OVER(ORDER BY sequence) previous
            FROM inventory_service_stops WHERE service_id=s.id) d WHERE d.offset_minutes<=d.previous)
        ))
      )
    ), candidates AS (
      SELECT s.*, r.origin_city_id,r.destination_city_id,
        coalesce(a.name,s.origin) published_origin,coalesce(b.name,s.destination) published_destination,
        coalesce(o.name,s.operator_name) published_operator,coalesce(l.vehicle_label,s.vehicle_label) published_vehicle, ((clock.today + d.day) + s.departure_local_time) AT TIME ZONE 'Asia/Kolkata' AS departure
      FROM inventory_services s LEFT JOIN routes r ON r.id=s.route_id
      LEFT JOIN cities a ON a.id=r.origin_city_id LEFT JOIN cities b ON b.id=r.destination_city_id
      LEFT JOIN operators o ON o.id=s.operator_id LEFT JOIN layouts l ON l.id=s.layout_id CROSS JOIN clock CROSS JOIN generate_series(1,${days}) AS d(day)
      WHERE s.active AND NOT EXISTS(SELECT 1 FROM invalid)
    ), missing AS (
      SELECT c.* FROM candidates c WHERE NOT EXISTS (
        SELECT 1 FROM trips t WHERE t.source_service_id=c.id AND t.departure_at=c.departure
      ) ORDER BY c.departure,c.id LIMIT ${batch}
    ), published AS (
      INSERT INTO trips(id,origin,destination,operator_name,source_service_id,route_id,origin_city_id,destination_city_id,operator_id,vehicle_label,departure_at,arrival_at,sales_close_at)
      SELECT gen_random_uuid(),published_origin,published_destination,published_operator,id,route_id,origin_city_id,destination_city_id,operator_id,published_vehicle,departure,
        departure+travel_minutes*interval '1 minute',departure-sales_lead_minutes*interval '1 minute' FROM missing
      ON CONFLICT(source_service_id,departure_at) DO NOTHING RETURNING id,source_service_id,departure_at
    ), copied AS (
      INSERT INTO trip_seats(trip_id,seat_label,position,fare_minor)
      SELECT p.id,s.label,s.position,s.fare_minor FROM published p JOIN inventory_service_seats s ON s.service_id=p.source_service_id RETURNING trip_id
    ), copied_stops AS (
      INSERT INTO trip_stops(id,trip_id,source_stop_id,city_id,name,address,role,sequence,scheduled_at)
      SELECT gen_random_uuid(),p.id,st.id,st.city_id,st.name,st.address,d.role,d.sequence,p.departure_at+d.offset_minutes*interval '1 minute'
      FROM published p JOIN inventory_service_stops d ON d.service_id=p.source_service_id JOIN stops st ON st.id=d.stop_id RETURNING trip_id
    ) SELECT (SELECT count(*)::int FROM published) AS created,
      (SELECT count(*)::int FROM invalid) AS invalid,
      (SELECT count(*)::int FROM copied) AS seats, (SELECT count(*)::int FROM copied_stops) AS stops`;
}
export function renewalPgQuery(days: number) {
  return new PgDialect().sqlToQuery(renewalQuery(days));
}
