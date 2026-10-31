import { mkdir, writeFile } from 'node:fs/promises';
import { fixtureClient } from '../tests/support/fixtures';
import { invariantQuery } from './recovery-audit';

const target = new URL(process.env.MIGRATION_DATABASE_URL ?? '');
if (
  target.hostname !== '127.0.0.1' ||
  target.port !== '55432' ||
  target.pathname !== '/quickbus_ci'
)
  throw Error('Load audits require the isolated loopback fixture database.');
const client = await fixtureClient();
try {
  const counts = (
    await client.query(`SELECT
    (SELECT count(*)::int FROM trips WHERE operator_name='Load fixture') trips,
    (SELECT count(*)::int FROM trip_seats s JOIN trips t ON t.id=s.trip_id WHERE t.operator_name='Load fixture') seats,
    (SELECT count(*)::int FROM bookings WHERE reference LIKE 'LOAD-%') historical_bookings,
    (SELECT count(*)::int FROM bookings WHERE status IN ('HELD','PAYMENT_PENDING')) active_bookings,
    (SELECT count(*)::int FROM seat_allocations) allocations,
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) connections,
    (SELECT count(*)::int FROM pg_locks WHERE NOT granted) waiting_locks`)
  ).rows[0];
  const invariants = (await client.query(invariantQuery)).rows[0].value;
  const report = { at: new Date().toISOString(), counts, invariants };
  await mkdir('artifacts/local/load', { recursive: true, mode: 0o700 });
  await writeFile(
    'artifacts/local/load/audit.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  if (Object.values(invariants).some((count) => count !== 0))
    process.exitCode = 1;
} finally {
  await client.end();
}
