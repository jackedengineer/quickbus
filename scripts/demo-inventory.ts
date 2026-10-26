import type pg from 'pg';
import { renewalPgQuery } from '../packages/db/src/inventory';
import { backfillTripCatalog, seedCatalog } from './catalog-seed';

export async function seedDemoInventory(client: pg.Client, days: number) {
  if (!Number.isInteger(days) || days < 1 || days > 30)
    throw new Error('Invalid seed horizon.');
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(74910250)');
    await seedCatalog(client);
    // Adopt existing snapshots without changing their IDs, quotes or bookings.
    await client.query(`UPDATE trips t SET source_service_id=s.id FROM inventory_services s WHERE t.source_service_id IS NULL
      AND t.operator_name=s.operator_name AND t.origin=s.origin AND t.destination=s.destination
      AND (t.departure_at AT TIME ZONE 'Asia/Kolkata')::time=s.departure_local_time AND s.id LIKE 'demo-%'`);
    let inserted = 0;
    for (let batch = 0; batch < 200; batch++) {
      const query = renewalPgQuery(days);
      const result = await client.query(query.sql, query.params);
      if (result.rows[0].invalid) throw new Error('Incomplete service layout.');
      inserted += result.rows[0].created;
      if (!result.rows[0].created) break;
      if (batch === 199)
        throw new Error('Inventory seed exceeded its bounded budget.');
    }
    await backfillTripCatalog(client);
    await client.query('COMMIT');
    console.log(
      `Added ${inserted} future demo journeys from database service definitions. Existing reservations were preserved.`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
