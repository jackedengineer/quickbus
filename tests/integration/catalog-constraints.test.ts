import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  createCustomers,
  createTrip,
  fixtureClient,
} from '../support/fixtures';

test('database rejects mismatched route cities, cross-trip stop references and malformed passenger/contact data', async () => {
  const owner = await fixtureClient();
  try {
    await owner.query('BEGIN');
    const [customer] = await createCustomers(owner, 1),
      trip = await createTrip(owner),
      id = randomUUID();
    const rejected = async (query: string, values: unknown[], code: string) => {
      await owner.query('SAVEPOINT invalid');
      await expect(owner.query(query, values)).rejects.toMatchObject({ code });
      await owner.query('ROLLBACK TO invalid');
    };
    await rejected(
      `UPDATE trips SET route_id='bengaluru-hyderabad',origin_city_id='bengaluru',destination_city_id='mumbai' WHERE id=$1`,
      [trip],
      '23503',
    );
    await rejected(
      `UPDATE trips SET route_id='bengaluru-hyderabad' WHERE id=$1`,
      [trip],
      '23514',
    );
    await owner.query(
      `INSERT INTO bookings(id,trip_id,user_id,reference,total_minor,expires_at) VALUES($1,$2,$3,$4,74900,clock_timestamp()+interval '10 minutes')`,
      [id, trip, customer.id, `fixture-${id}`],
    );
    const stops = (
      await owner.query(
        "SELECT p.id pickup,d.id drop FROM trip_stops p JOIN trip_stops d ON d.trip_id=p.trip_id WHERE p.role='PICKUP' AND d.role='DROP' LIMIT 1",
      )
    ).rows[0];
    expect(stops).toBeTruthy();
    await rejected(
      'UPDATE bookings SET pickup_stop_id=$2,drop_stop_id=$3 WHERE id=$1',
      [id, stops.pickup, stops.drop],
      '23503',
    );
    await rejected(
      'UPDATE bookings SET contact_phone=$2 WHERE id=$1',
      [id, '919876543210'],
      '23514',
    );
    await rejected('UPDATE bookings SET version=0 WHERE id=$1', [id], '23514');
    await rejected(
      `INSERT INTO booking_items(booking_id,trip_id,seat_label,fare_minor,passenger_name) VALUES($1,$2,'1A',74900,'  ')`,
      [id, trip],
      '23514',
    );
    await rejected(
      `INSERT INTO booking_items(booking_id,trip_id,seat_label,fare_minor,passenger_name) VALUES($1,$2,'1A',74900,E'Demo\nName')`,
      [id, trip],
      '23514',
    );
    await owner.query(
      `INSERT INTO booking_events(id,booking_id,type,version) VALUES(gen_random_uuid(),$1,'DETAILS_SAVED',2),(gen_random_uuid(),$1,'DETAILS_SAVED',3)`,
      [id],
    );
    await rejected(
      `INSERT INTO booking_events(id,booking_id,type,version) VALUES(gen_random_uuid(),$1,'DETAILS_SAVED',3)`,
      [id],
      '23505',
    );
  } finally {
    await owner.query('ROLLBACK');
    await owner.end();
  }
});
