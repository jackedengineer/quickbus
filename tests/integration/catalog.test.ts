import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { expect, test } from 'vitest';
import { renewalPgQuery } from '../../packages/db/src/inventory';
import { seedDemoInventory } from '../../scripts/demo-inventory';
import { fixtureClient } from '../support/fixtures';

test('normalized publication validates stops/layout and rolls back either snapshot failure', async () => {
  const owner = await fixtureClient();
  const id = `fixture-${randomUUID()}`;
  const publish = () => {
    const q = renewalPgQuery(1);
    return owner.query(q.sql, q.params);
  };
  try {
    await owner.query('BEGIN');
    await owner.query('UPDATE inventory_services SET active=false');
    await owner.query(
      `INSERT INTO inventory_services
      SELECT $1,origin,destination,operator_name,vehicle_label,departure_local_time,travel_minutes,sales_lead_minutes,seat_count,true,route_id,operator_id,layout_id
      FROM inventory_services WHERE id='demo-blr-hyd-20'`,
      [id],
    );
    await owner.query(
      `INSERT INTO inventory_service_seats SELECT $1,label,position,fare_minor FROM inventory_service_seats WHERE service_id='demo-blr-hyd-20'`,
      [id],
    );
    expect((await publish()).rows[0]).toMatchObject({ created: 0, invalid: 1 });
    await owner.query(
      `INSERT INTO inventory_service_stops SELECT $1,stop_id,role,sequence,offset_minutes FROM inventory_service_stops WHERE service_id='demo-blr-hyd-20'`,
      [id],
    );
    await owner.query('SAVEPOINT valid');
    await owner.query(
      `UPDATE inventory_service_stops SET offset_minutes=0 WHERE service_id=$1 AND sequence=2`,
      [id],
    );
    expect((await publish()).rows[0]).toMatchObject({ created: 0, invalid: 1 });
    await owner.query('ROLLBACK TO valid');
    await owner.query(
      `UPDATE inventory_service_seats SET label='99A' WHERE service_id=$1 AND position=1`,
      [id],
    );
    expect((await publish()).rows[0]).toMatchObject({ created: 0, invalid: 1 });
    await owner.query('ROLLBACK TO valid');
    for (const table of ['trip_seats', 'trip_stops']) {
      await owner.query(`CREATE FUNCTION p1_snapshot_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'intentional fixture snapshot fault'; END $$`);
      await owner.query(
        `CREATE TRIGGER p1_snapshot_fault BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION p1_snapshot_fault()`,
      );
      await owner.query('SAVEPOINT fault');
      await expect(publish()).rejects.toThrow();
      await owner.query('ROLLBACK TO fault');
      expect(
        (
          await owner.query(
            'SELECT count(*)::int n FROM trips WHERE source_service_id=$1',
            [id],
          )
        ).rows[0].n,
      ).toBe(0);
      await owner.query(`DROP TRIGGER p1_snapshot_fault ON ${table}`);
      await owner.query('DROP FUNCTION p1_snapshot_fault()');
    }
    expect((await publish()).rows[0]).toMatchObject({
      created: 1,
      invalid: 0,
      seats: 40,
      stops: 4,
    });
    expect((await publish()).rows[0].created).toBe(0);
  } finally {
    await owner.query('ROLLBACK');
    await owner.end();
  }
});

test('owner seed replay preserves published stop IDs, fares and journey identity', async () => {
  const owner = await fixtureClient();
  try {
    const snapshot = async () =>
      (
        await owner.query(`SELECT t.id,s.id stop_id,ts.seat_label,ts.fare_minor
      FROM trips t JOIN trip_stops s ON s.trip_id=t.id JOIN trip_seats ts ON ts.trip_id=t.id
      WHERE t.source_service_id='demo-blr-hyd-20' ORDER BY t.id,s.id,ts.seat_label`)
      ).rows;
    const before = await snapshot();
    expect(before.length).toBeGreaterThan(0);
    await seedDemoInventory(owner, 7);
    expect(await snapshot()).toEqual(before);
  } finally {
    await owner.end();
  }
});

test('actual runtime connection can read catalog but cannot edit its definitions', async () => {
  const runtime = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await runtime.connect();
  try {
    expect(
      (await runtime.query('SELECT id FROM cities LIMIT 1')).rowCount,
    ).toBe(1);
    await expect(runtime.query('UPDATE cities SET name=name')).rejects.toThrow(
      /permission denied/,
    );
  } finally {
    await runtime.end();
  }
});
