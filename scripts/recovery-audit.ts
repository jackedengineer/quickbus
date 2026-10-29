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
    (SELECT count(*) FROM trip_seats WHERE trip_id=t.id)<>s.seat_count),
  'intentQuoteMismatch',(SELECT count(*)::int FROM payment_intents i JOIN bookings b ON b.id=i.booking_id
    WHERE i.amount<>b.total_minor OR i.currency<>b.currency),
  'confirmedWithoutMoney',(SELECT count(*)::int FROM bookings b WHERE b.status='CONFIRMED' AND
    (SELECT count(*) FROM provider_payments p JOIN payment_intents i ON i.id=p.intent_id
     WHERE i.booking_id=b.id AND p.disposition='FULFILLED' AND p.state='captured'
       AND p.amount=b.total_minor AND p.currency=b.currency)<>1),
  'fulfillmentWithoutBooking',(SELECT count(*)::int FROM provider_payments p JOIN payment_intents i ON i.id=p.intent_id
    JOIN bookings b ON b.id=i.booking_id WHERE p.disposition='FULFILLED' AND b.status<>'CONFIRMED'),
  'refundQuoteMismatch',(SELECT count(*)::int FROM payment_refunds r JOIN provider_payments p ON p.id=r.payment_id
    WHERE r.amount<>p.amount OR p.currency<>'INR' OR p.disposition<>'REFUND'),
  'captureWithoutDisposition',(SELECT count(*)::int FROM provider_payments p
    WHERE p.state IN ('captured','refunded') AND p.disposition='PENDING'),
  'compensationWithoutRefund',(SELECT count(*)::int FROM provider_payments p WHERE p.disposition='REFUND' AND
    NOT EXISTS(SELECT 1 FROM payment_refunds r WHERE r.payment_id=p.id)),
  'refundWithoutJob',(SELECT count(*)::int FROM payment_refunds r WHERE
    NOT EXISTS(SELECT 1 FROM payment_jobs j WHERE j.kind='REFUND' AND j.resource_id=r.id)),
  'checkoutWithoutRecovery',(SELECT count(*)::int FROM checkout_attempts c WHERE
    NOT EXISTS(SELECT 1 FROM payment_jobs j WHERE j.kind='RECONCILE' AND j.resource_id=c.id)),
  'inboxWithoutJob',(SELECT count(*)::int FROM payment_inbox i WHERE
    NOT EXISTS(SELECT 1 FROM payment_jobs j WHERE j.kind='INBOX' AND j.resource_id=i.id)),
  'cancelledHistoryWithoutTerminalBooking',(SELECT count(*)::int FROM booking_cancellations c JOIN bookings b ON b.id=c.booking_id WHERE b.status<>'CANCELLED'),
  'cancelledFareMismatch',(SELECT count(*)::int FROM booking_cancellations c JOIN bookings b ON b.id=c.booking_id
    WHERE c.refund_minor>0 AND (c.refund_minor<>b.total_minor OR NOT EXISTS(SELECT 1 FROM payment_intents i JOIN provider_payments p ON p.intent_id=i.id
      JOIN payment_refunds r ON r.payment_id=p.id WHERE i.booking_id=b.id AND p.disposition='REFUND' AND r.amount=c.refund_minor))),
  'tripCancellationWithoutJob',(SELECT count(*)::int FROM trip_cancellations c JOIN trips t ON t.id=c.trip_id WHERE t.sales_state<>'CANCELLED' OR
    NOT EXISTS(SELECT 1 FROM payment_jobs j WHERE j.kind='TRIP_CANCEL' AND j.resource_id=c.trip_id)),
  'completedTripWithActiveBookings',(SELECT count(*)::int FROM trip_cancellations c WHERE c.completed_at IS NOT NULL AND
    EXISTS(SELECT 1 FROM bookings b WHERE b.trip_id=c.trip_id AND b.status IN ('HELD','PAYMENT_PENDING','CONFIRMED'))),
  'notificationWithoutEvent',(SELECT count(*)::int FROM booking_notifications n WHERE NOT EXISTS(
    SELECT 1 FROM booking_events e WHERE e.booking_id=n.booking_id AND e.type=n.kind)),
  'sentNotificationWithoutIdentity',(SELECT count(*)::int FROM booking_notifications WHERE state='SENT' AND provider_id IS NULL),
  'processedRefundWithoutIdentity',(SELECT count(*)::int FROM payment_refunds WHERE state='PROCESSED' AND provider_id IS NULL)
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
