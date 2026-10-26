import type pg from 'pg';
export async function applyRuntimeGrants(client: pg.Client, role: string) {
  if (!['quickbus_runtime', 'kwikbus_v0_runtime'].includes(role))
    throw new Error('Unreviewed runtime role.');
  // Fixed identifiers only. No schema ownership, DDL, role management or edits to
  // service definitions. The runtime can publish snapshots from those definitions.
  await client.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  await client.query(
    `GRANT SELECT ON trips,trip_seats,inventory_services,inventory_service_seats TO "${role}"`,
  );
  await client.query(`GRANT INSERT ON trips,trip_seats TO "${role}"`);
  await client.query(`GRANT UPDATE(sales_state) ON trips TO "${role}"`);
  await client.query(
    `GRANT SELECT,INSERT,UPDATE,DELETE ON "user",session,account,verification,two_factor,rate_limit,bookings,booking_items,seat_allocations,idempotency_keys,booking_events TO "${role}"`,
  );
  await client.query(
    `GRANT SELECT,INSERT,UPDATE ON maintenance_jobs TO "${role}"`,
  );
}
