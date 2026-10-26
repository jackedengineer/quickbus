import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { fixtureClient } from '../support/fixtures';

test('scheduled publication is atomic, bounded and duplicate-safe; incomplete layouts fail visibly', async () => {
  const owner = await fixtureClient();
  const service = `fixture-${randomUUID()}`;
  const invoke = () =>
    fetch(
      'http://localhost:8787/cdn-cgi/local/scheduled?cron=17+*+*+*+*&format=json',
    );
  try {
    await owner.query(
      `INSERT INTO inventory_services(id,origin,destination,operator_name,vehicle_label,departure_local_time,travel_minutes,sales_lead_minutes,seat_count)
      VALUES($1,'Fixture origin','Fixture destination','Fixture service','AC Seater (2+2)','20:00',600,30,2)`,
      [service],
    );
    expect((await invoke()).status).toBeGreaterThanOrEqual(500);
    expect(
      (
        await owner.query(
          'SELECT count(*)::int n FROM trips WHERE source_service_id=$1',
          [service],
        )
      ).rows[0].n,
    ).toBe(0);
    await owner.query(
      `INSERT INTO inventory_service_seats(service_id,label,position,fare_minor) VALUES($1,'1A',1,74900),($1,'1B',2,74900)`,
      [service],
    );
    const results = await Promise.all([invoke(), invoke()]);
    expect(results.every((r) => r.ok)).toBe(true);
    const counts = await owner.query(
      `SELECT count(*)::int trips, count(DISTINCT departure_at)::int departures,
      bool_and((SELECT count(*) FROM trip_seats s WHERE s.trip_id=t.id)=2) complete
      FROM trips t WHERE source_service_id=$1`,
      [service],
    );
    expect(counts.rows[0].trips).toBeGreaterThan(0);
    expect(counts.rows[0].trips).toBeLessThanOrEqual(10);
    expect(counts.rows[0].departures).toBe(counts.rows[0].trips);
    expect(counts.rows[0].complete).toBe(true);
    const before = counts.rows[0].trips;
    // Fault is scoped to this synthetic service only; guard prevents production.
    await owner.query(`CREATE FUNCTION p0_inventory_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.seat_label='1B' AND EXISTS(SELECT 1 FROM trips WHERE id=NEW.trip_id AND source_service_id='${service}') THEN
        RAISE EXCEPTION 'intentional synthetic inventory fault'; END IF; RETURN NEW; END $$`);
    await owner.query(
      'CREATE TRIGGER p0_inventory_fault BEFORE INSERT ON trip_seats FOR EACH ROW EXECUTE FUNCTION p0_inventory_fault()',
    );
    expect((await invoke()).status).toBeGreaterThanOrEqual(500);
    expect(
      (
        await owner.query(
          'SELECT count(*)::int n FROM trips WHERE source_service_id=$1',
          [service],
        )
      ).rows[0].n,
    ).toBe(before);
    const heartbeat = await owner.query(
      "SELECT last_failed_at IS NOT NULL failed FROM maintenance_jobs WHERE name='inventory'",
    );
    expect(heartbeat.rows[0].failed).toBe(true);
  } finally {
    await owner.query(
      'DROP TRIGGER IF EXISTS p0_inventory_fault ON trip_seats',
    );
    await owner.query('DROP FUNCTION IF EXISTS p0_inventory_fault()');
    await owner.query(
      'DELETE FROM trip_seats WHERE trip_id IN(SELECT id FROM trips WHERE source_service_id=$1)',
      [service],
    );
    await owner.query('DELETE FROM trips WHERE source_service_id=$1', [
      service,
    ]);
    await owner.query(
      'DELETE FROM inventory_service_seats WHERE service_id=$1',
      [service],
    );
    await owner.query('DELETE FROM inventory_services WHERE id=$1', [service]);
    await owner.end();
  }
}, 60000);
