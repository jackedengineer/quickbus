// Structural/aggregate evidence only: never select customer rows or credentials.
export const tablesQuery = `SELECT schemaname,name FROM (
  SELECT schemaname,tablename AS name FROM pg_tables WHERE schemaname IN ('public','drizzle')
) t ORDER BY schemaname,name`;
export const schemaQuery = `SELECT json_build_object(
  'columns',(SELECT json_agg(row_to_json(x)) FROM (
    SELECT n.nspname schema,c.relname tab,a.attname col,format_type(a.atttypid,a.atttypmod) type,a.attnotnull required,
      pg_get_expr(d.adbin,d.adrelid) default_value
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname IN ('public','drizzle') AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY n.nspname,c.relname,a.attnum) x),
  'constraints',(SELECT json_agg(row_to_json(x)) FROM (
    SELECT n.nspname schema,c.relname tab,k.conname name,pg_get_constraintdef(k.oid,true) definition
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','drizzle') ORDER BY n.nspname,c.relname,k.conname) x),
  'indexes',(SELECT json_agg(row_to_json(x)) FROM (
    SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname IN ('public','drizzle')
    ORDER BY schemaname,tablename,indexname) x)
) value`;
export const invariantQuery = `SELECT json_build_object(
  'missingHeldAllocations',(SELECT count(*)::int FROM booking_items i JOIN bookings b ON b.id=i.booking_id
    LEFT JOIN seat_allocations a ON a.booking_id=i.booking_id AND a.trip_id=i.trip_id AND a.seat_label=i.seat_label WHERE b.status IN ('HELD','PAYMENT_PENDING','CONFIRMED') AND a.booking_id IS NULL),
  'terminalAllocations',(SELECT count(*)::int FROM seat_allocations a JOIN bookings b ON b.id=a.booking_id WHERE b.status IN ('EXPIRED','CANCELLED')),
  'incorrectQuotes',(SELECT count(*)::int FROM bookings b WHERE total_minor<>(SELECT sum(fare_minor) FROM booking_items WHERE booking_id=b.id)),
  'crossTripStopChoices',(SELECT count(*)::int FROM bookings b WHERE
    (pickup_stop_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM trip_stops WHERE trip_id=b.trip_id AND id=b.pickup_stop_id AND role='PICKUP')) OR
    (drop_stop_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM trip_stops WHERE trip_id=b.trip_id AND id=b.drop_stop_id AND role='DROP'))),
  'missingDetailEvents',(SELECT count(*)::int FROM bookings b WHERE b.version>1 AND NOT EXISTS(
    SELECT 1 FROM booking_events e WHERE e.booking_id=b.id AND e.type='DETAILS_SAVED' AND e.version=b.version)),
  'incompleteCatalogSnapshots',(SELECT count(*)::int FROM trips t WHERE route_id IS NOT NULL AND (
    NOT EXISTS(SELECT 1 FROM trip_stops WHERE trip_id=t.id AND role='PICKUP') OR
    NOT EXISTS(SELECT 1 FROM trip_stops WHERE trip_id=t.id AND role='DROP'))),
  'partialServiceTrips',(SELECT count(*)::int FROM trips t JOIN inventory_services s ON s.id=t.source_service_id WHERE
    (SELECT count(*) FROM trip_seats WHERE trip_id=t.id)<>s.seat_count)
) value`;
export function countsQuery(tables: { schemaname: string; name: string }[]) {
  const entries = tables.map((t) => {
    if (
      !['public', 'drizzle'].includes(t.schemaname) ||
      !/^[a-z_]+$/.test(t.name)
    )
      throw new Error('Unexpected audit identifier.');
    return `SELECT '${t.schemaname}.${t.name}' name,count(*)::int rows FROM "${t.schemaname}"."${t.name}"`;
  });
  return `SELECT json_object_agg(name,rows ORDER BY name) value FROM (${entries.join(' UNION ALL ')}) counts`;
}
