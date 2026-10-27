import type pg from 'pg';
export async function applyRuntimeGrants(client: pg.Client, role: string) {
  if (!['quickbus_runtime', 'kwikbus_v0_runtime'].includes(role))
    throw new Error('Unreviewed runtime role.');
  // Fixed identifiers only. No schema ownership, DDL, role management or edits to
  // service definitions. The runtime can publish snapshots from those definitions.
  await client.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  await client.query(
    `GRANT SELECT ON trips,trip_seats,trip_stops,inventory_services,inventory_service_seats,inventory_service_stops,cities,city_aliases,operators,routes,layouts,layout_seats,stops TO "${role}"`,
  );
  await client.query(
    `GRANT INSERT ON trips,trip_seats,trip_stops TO "${role}"`,
  );
  await client.query(`GRANT UPDATE(sales_state) ON trips TO "${role}"`);
  await client.query(
    `GRANT SELECT,INSERT,UPDATE,DELETE ON "user",session,account,verification,two_factor,rate_limit,bookings,booking_items,seat_allocations,idempotency_keys,booking_events TO "${role}"`,
  );
  await client.query(
    `GRANT SELECT,INSERT,UPDATE ON maintenance_jobs TO "${role}"`,
  );
  await client.query(`GRANT SELECT,INSERT,UPDATE ON payment_jobs TO "${role}"`);
  // Remove the earlier table-wide update grant before narrowing it. A runtime
  // compromise must not rewrite the quoted amount, provider identity or evidence.
  await client.query(
    `REVOKE UPDATE ON payment_intents,checkout_attempts,provider_payments,payment_refunds,payment_inbox,payment_cases FROM "${role}"`,
  );
  await client.query(
    `GRANT SELECT,INSERT ON payment_intents,checkout_attempts,provider_payments,payment_refunds,payment_inbox,payment_cases TO "${role}"`,
  );
  await client.query(
    `GRANT UPDATE(state,order_id,started_at,last_checked_at) ON checkout_attempts TO "${role}"`,
  );
  await client.query(
    `GRANT UPDATE(state,disposition,updated_at) ON provider_payments TO "${role}"`,
  );
  await client.query(
    `GRANT UPDATE(state,provider_id,started_at,updated_at) ON payment_refunds TO "${role}"`,
  );
  await client.query(
    `GRANT UPDATE(processed_at) ON payment_inbox TO "${role}"`,
  );
  await client.query(`GRANT UPDATE(state) ON payment_cases TO "${role}"`);
}
