import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';

export async function fixtureClient() {
  if (
    process.env.DEPLOYMENT_ENV !== 'local' ||
    process.env.ALLOW_DEV_FIXTURES !== 'true' ||
    !['/quickbus', '/quickbus_ci'].includes(
      new URL(process.env.MIGRATION_DATABASE_URL ?? '').pathname,
    )
  ) {
    throw new Error(
      'Synthetic fixtures require local mode and ALLOW_DEV_FIXTURES=true.',
    );
  }
  const client = new pg.Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    connectionTimeoutMillis: 8000,
    query_timeout: 10000,
  });
  await client.connect();
  return client;
}

// Test-only signed sessions for synthetic users, matching the pinned Better Auth
// HMAC cookie format. The deployed API still validates the real session normally.
export async function createCustomers(client: pg.Client, count: number) {
  const customers = Array.from({ length: count }, () => ({
    id: randomUUID(),
    token: randomUUID(),
  }));
  await client.query(
    `INSERT INTO "user" (id,name,email,email_verified) SELECT id,'Concurrency fixture',id || '@quickbus.test',true FROM unnest($1::text[]) AS id`,
    [customers.map((c) => c.id)],
  );
  await client.query(
    `INSERT INTO "session" (id,user_id,token,expires_at,updated_at) SELECT id,id,token,now()+interval '1 day',now() FROM unnest($1::text[],$2::text[]) AS t(id,token)`,
    [customers.map((c) => c.id), customers.map((c) => c.token)],
  );
  return customers.map((c) => ({
    id: c.id,
    cookie: `better-auth.session_token=${encodeURIComponent(
      `${c.token}.${createHmac('sha256', process.env.AUTH_SECRET ?? '')
        .update(c.token)
        .digest('base64')}`,
    )}`,
  }));
}

export async function createTrip(
  client: pg.Client,
  seats = ['1A', '1B', '1C'],
) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO trips(id,origin,destination,operator_name,departure_at,arrival_at,sales_close_at) VALUES ($1,'Bengaluru','Hyderabad','KwikBus Preview',now()+interval '1 day',now()+interval '32 hours',now()+interval '23 hours')`,
    [id],
  );
  await client.query(
    `INSERT INTO trip_seats(trip_id,seat_label,position,fare_minor) SELECT $1,label,ord,74900 FROM unnest($2::text[]) WITH ORDINALITY AS t(label,ord)`,
    [id, seats],
  );
  return id;
}

export async function cleanupFixtures(
  client: pg.Client,
  tripIds: string[],
  customerIds: string[],
) {
  await client.query('BEGIN');
  try {
    await client.query(
      'DELETE FROM booking_events WHERE booking_id IN (SELECT id FROM bookings WHERE trip_id=ANY($1::uuid[]))',
      [tripIds],
    );
    await client.query(
      'DELETE FROM seat_allocations WHERE trip_id=ANY($1::uuid[])',
      [tripIds],
    );
    await client.query(
      'DELETE FROM booking_items WHERE trip_id=ANY($1::uuid[])',
      [tripIds],
    );
    await client.query('DELETE FROM bookings WHERE trip_id=ANY($1::uuid[])', [
      tripIds,
    ]);
    await client.query('DELETE FROM trip_seats WHERE trip_id=ANY($1::uuid[])', [
      tripIds,
    ]);
    await client.query('DELETE FROM trips WHERE id=ANY($1::uuid[])', [tripIds]);
    await client.query(
      'DELETE FROM idempotency_keys WHERE principal_id=ANY($1::text[])',
      [customerIds],
    );
    await client.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [
      customerIds,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
