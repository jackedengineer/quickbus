import { randomUUID } from 'node:crypto';
import { fixtureClient } from '../tests/support/fixtures';

const client = await fixtureClient();
try {
  await client.query('BEGIN');
  // Stable per-date IDs are not needed: a unique operator/departure check under this seed lock makes reruns safe.
  await client.query('SELECT pg_advisory_xact_lock(74910250)');
  const seats = Array.from(
    { length: 40 },
    (_, i) => `${Math.floor(i / 4) + 1}${'ABCD'[i % 4]}`,
  );
  let inserted = 0;
  for (let day = 1; day <= 7; day++)
    for (const [origin, destination, hour, fare] of [
      ['Bengaluru', 'Hyderabad', 20, 74900],
      ['Bengaluru', 'Hyderabad', 22, 89900],
      ['Hyderabad', 'Bengaluru', 21, 79900],
    ] as const) {
      const start = await client.query<{ departure: string }>(
        `SELECT ((date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Kolkata') + $1*interval '1 day' + $2*interval '1 hour') AT TIME ZONE 'Asia/Kolkata')::text AS departure`,
        [day, hour],
      );
      const departure = start.rows[0].departure;
      const existing = await client.query(
        `SELECT id FROM trips WHERE operator_name='QuickBus Demo' AND origin=$1 AND destination=$2 AND departure_at=$3`,
        [origin, destination, departure],
      );
      if (existing.rowCount) continue;
      const id = randomUUID();
      await client.query(
        `INSERT INTO trips(id,origin,destination,operator_name,departure_at,arrival_at,sales_close_at) VALUES($1,$2,$3,'QuickBus Demo',$4::timestamptz,$4::timestamptz+interval '10 hours',$4::timestamptz-interval '30 minutes')`,
        [id, origin, destination, departure],
      );
      await client.query(
        `INSERT INTO trip_seats(trip_id,seat_label,position,fare_minor) SELECT $1,label,ord,$3 FROM unnest($2::text[]) WITH ORDINALITY AS t(label,ord)`,
        [id, seats, fare],
      );
      inserted++;
    }
  await client.query('COMMIT');
  console.log(
    `Added ${inserted} future demo journeys. Existing reservations were preserved.`,
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
