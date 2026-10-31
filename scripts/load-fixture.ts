import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { createCustomers } from '../tests/support/fixtures';
import { invariantQuery } from './recovery-audit';

// Load fixtures are deliberately restricted more tightly than normal dev seeds.
const target = new URL(process.env.MIGRATION_DATABASE_URL ?? '');
if (
  target.hostname !== '127.0.0.1' ||
  target.port !== '55432' ||
  target.pathname !== '/quickbus_ci' ||
  process.env.DEPLOYMENT_ENV !== 'local' ||
  process.env.ALLOW_DEV_FIXTURES !== 'true' ||
  process.env.CI_DATABASE_PROXY !== '127.0.0.1:6543'
)
  throw Error('Load fixtures require the isolated loopback CI database.');
const client = new pg.Client({
  connectionString: target.href,
  connectionTimeoutMillis: 8000,
  query_timeout: 120000,
});
await client.connect();
try {
  const existing = await client.query(
    "SELECT count(*)::int n FROM trips WHERE operator_name='Load fixture'",
  );
  if (existing.rows[0].n)
    throw Error('Use a fresh disposable fixture database.');
  const customers = await createCustomers(client, 3000);
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout='120s'");
  // Copy complete published snapshots, spreading departures over the real
  // 28-day search horizon. Keep the first route hot rather than uniform skew.
  await client.query(`CREATE TEMP TABLE load_trip_ids ON COMMIT DROP AS
    SELECT gen_random_uuid() id,n,(SELECT id FROM trips WHERE route_id IS NOT NULL
      ORDER BY (origin='Pune') DESC,departure_at LIMIT 1) template,
      now()+interval '1 day'+((n-1)%27)*interval '1 day'+((n-1)/27)*interval '30 seconds' departure
    FROM generate_series(1,10000) n`);
  await client.query(`INSERT INTO trips(id,route_id,origin_city_id,destination_city_id,operator_id,
      origin,destination,operator_name,vehicle_label,departure_at,arrival_at,sales_close_at)
    SELECT f.id,t.route_id,t.origin_city_id,t.destination_city_id,t.operator_id,
      t.origin,t.destination,'Load fixture',t.vehicle_label,f.departure,
      f.departure+(t.arrival_at-t.departure_at),f.departure-interval '30 minutes'
    FROM load_trip_ids f JOIN trips t ON t.id=f.template`);
  await client.query(`INSERT INTO trip_seats(trip_id,seat_label,position,fare_minor)
    SELECT f.id,s.seat_label,s.position,s.fare_minor FROM load_trip_ids f
    JOIN trip_seats s ON s.trip_id=f.template`);
  await client.query(`INSERT INTO trip_stops(id,trip_id,source_stop_id,city_id,name,address,role,sequence,scheduled_at)
    SELECT gen_random_uuid(),f.id,s.source_stop_id,s.city_id,s.name,s.address,s.role,s.sequence,
      f.departure+(s.scheduled_at-t.departure_at) FROM load_trip_ids f
      JOIN trips t ON t.id=f.template JOIN trip_stops s ON s.trip_id=t.id`);
  // Real historical aggregates/items/events. These are terminal and own no seats.
  await client.query(`CREATE TEMP TABLE load_history ON COMMIT DROP AS
    SELECT gen_random_uuid() id,t.id trip_id,u.id user_id FROM load_trip_ids t
    CROSS JOIN generate_series(1,10) n
    CROSS JOIN LATERAL (SELECT id FROM "user" ORDER BY id LIMIT 1) u`);
  await client.query(`INSERT INTO bookings(id,trip_id,user_id,reference,status,total_minor,expires_at,created_at)
    SELECT h.id,h.trip_id,h.user_id,'LOAD-'||h.id,'EXPIRED',s.fare_minor,
      now()-interval '1 day',now()-interval '2 days' FROM load_history h
      JOIN trip_seats s ON s.trip_id=h.trip_id AND s.position=1`);
  await client.query(`INSERT INTO booking_items(booking_id,trip_id,seat_label,fare_minor)
    SELECT h.id,h.trip_id,s.seat_label,s.fare_minor FROM load_history h
    JOIN trip_seats s ON s.trip_id=h.trip_id AND s.position=1`);
  await client.query(`INSERT INTO booking_events(id,booking_id,type,version)
    SELECT gen_random_uuid(),id,'EXPIRED',1 FROM load_history`);
  const trips = (
    await client.query(`SELECT t.id,t.origin,t.destination,
    (t.departure_at AT TIME ZONE 'Asia/Kolkata')::date::text date,
    (SELECT fare_minor FROM trip_seats WHERE trip_id=t.id AND position=1) fare,
    (SELECT id FROM trip_stops WHERE trip_id=t.id AND role='PICKUP' ORDER BY sequence LIMIT 1) pickup,
    (SELECT id FROM trip_stops WHERE trip_id=t.id AND role='DROP' ORDER BY sequence DESC LIMIT 1) drop
    FROM trips t JOIN load_trip_ids f ON f.id=t.id ORDER BY f.n LIMIT 1000`)
  ).rows;
  await client.query('COMMIT');
  await client.query('ANALYZE');
  const invariants = (await client.query(invariantQuery)).rows[0].value;
  if (Object.values(invariants).some((n) => n !== 0))
    throw Error('Seed invariant audit failed.');
  const directory = 'artifacts/local/load';
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    `${directory}/fixture.json`,
    JSON.stringify({
      id: randomUUID(),
      origin: process.env.APP_ORIGIN,
      trips,
      customers,
    }),
    { mode: 0o600 },
  );
  await writeFile(
    `${directory}/seed-audit.json`,
    JSON.stringify(
      {
        trips: 10000,
        seats: 400000,
        historicalBookings: 100000,
        customers: customers.length,
        invariants,
      },
      null,
      2,
    ),
  );
  console.log(
    'Isolated load fixture ready: 10,000 trips, 400,000 seats, 100,000 historical bookings.',
  );
} finally {
  await client.end();
}
