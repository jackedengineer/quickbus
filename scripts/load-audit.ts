import { mkdir, writeFile } from 'node:fs/promises';
import { loadTarget } from './load-target';
import { invariantQuery } from './recovery-audit';

const { client, directory } = loadTarget();
await client.connect();
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
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(`${directory}/audit.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (Object.values(invariants).some((count) => count !== 0))
    process.exitCode = 1;
} finally {
  await client.end();
}
