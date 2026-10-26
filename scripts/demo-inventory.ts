import type pg from 'pg';
import { renewalPgQuery } from '../packages/db/src/inventory';

export async function seedDemoInventory(client: pg.Client, days: number) {
  if (!Number.isInteger(days) || days < 1 || days > 30)
    throw new Error('Invalid seed horizon.');
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(74910250)');
    // Bootstrap definitions once. Future renewal reads these rows, never an
    // in-memory timetable. Existing definitions/manual edits are preserved.
    for (const [id, origin, destination, hour, fare] of [
      ['demo-blr-hyd-20', 'Bengaluru', 'Hyderabad', 20, 74900],
      ['demo-blr-hyd-22', 'Bengaluru', 'Hyderabad', 22, 89900],
      ['demo-hyd-blr-21', 'Hyderabad', 'Bengaluru', 21, 79900],
    ] as const) {
      const added = await client.query(
        `INSERT INTO inventory_services(id,origin,destination,operator_name,vehicle_label,departure_local_time,travel_minutes,sales_lead_minutes,seat_count)
        VALUES($1,$2,$3,'KwikBus Demo','AC Seater (2+2)',make_time($4,0,0),600,30,40) ON CONFLICT DO NOTHING RETURNING id`,
        [id, origin, destination, hour],
      );
      if (added.rowCount)
        await client.query(
          `INSERT INTO inventory_service_seats(service_id,label,position,fare_minor)
        SELECT $1,((n-1)/4+1)::text || substr('ABCD',(n-1)%4+1,1),n,$2 FROM generate_series(1,40) n`,
          [id, fare],
        );
    }
    // Adopt existing snapshots without changing their IDs, quotes or bookings.
    await client.query(`UPDATE trips t SET source_service_id=s.id FROM inventory_services s WHERE t.source_service_id IS NULL
      AND t.operator_name=s.operator_name AND t.origin=s.origin AND t.destination=s.destination
      AND (t.departure_at AT TIME ZONE 'Asia/Kolkata')::time=s.departure_local_time AND s.id LIKE 'demo-%'`);
    let inserted = 0;
    for (let batch = 0; batch < 20; batch++) {
      const query = renewalPgQuery(days);
      const result = await client.query(query.sql, query.params);
      if (result.rows[0].invalid) throw new Error('Incomplete service layout.');
      inserted += result.rows[0].created;
      if (!result.rows[0].created) break;
    }
    await client.query('COMMIT');
    console.log(
      `Added ${inserted} future demo journeys from database service definitions. Existing reservations were preserved.`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
