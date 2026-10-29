import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { sql } from '../../packages/db/src/schema';
import { invariantQuery } from '../../scripts/recovery-audit';
import { paymentFixture } from '../support/payments';

test('lifecycle audit independently detects an incomplete trip cancellation and immutable operator evidence', async () => {
  const f = await paymentFixture();
  const audit = async () => (await f.owner.query(invariantQuery)).rows[0].value;
  try {
    const permissions = await f.runtime.db.execute(sql`SELECT
      has_column_privilege(current_user,'trip_cancellations','actor','UPDATE') actor,
      has_column_privilege(current_user,'trip_cancellations','reason','UPDATE') reason,
      has_column_privilege(current_user,'trip_cancellations','processed_bookings','UPDATE') progress,
      has_table_privilege(current_user,'trip_cancellations','DELETE') delete_request,
      has_table_privilege(current_user,'booking_cancellations','UPDATE') edit_history`);
    expect(permissions.rows[0]).toEqual({
      actor: false,
      reason: false,
      progress: true,
      delete_request: false,
      edit_history: false,
    });
    const before = await audit();
    await f.owner.query('BEGIN');
    // Owner-only corruption remains uncommitted and is never visible to the app.
    await f.owner.query(
      "INSERT INTO trip_cancellations(trip_id,actor,reason,completed_at) VALUES($1,'audit-fixture','DEMO_RECOVERY',clock_timestamp())",
      [f.trip],
    );
    const broken = await audit();
    expect(broken.tripCancellationWithoutJob).toBe(
      before.tripCancellationWithoutJob + 1,
    );
    expect(broken.completedTripWithActiveBookings).toBe(
      before.completedTripWithActiveBookings + 1,
    );
    await f.owner.query(
      "UPDATE trips SET sales_state='CANCELLED' WHERE id=$1",
      [f.trip],
    );
    await f.owner.query(
      "INSERT INTO payment_jobs(id,kind,resource_id) VALUES($1,'TRIP_CANCEL',$2)",
      [randomUUID(), f.trip],
    );
    await f.owner.query(
      'UPDATE trip_cancellations SET completed_at=NULL WHERE trip_id=$1',
      [f.trip],
    );
    const repaired = await audit();
    expect(repaired.tripCancellationWithoutJob).toBe(
      before.tripCancellationWithoutJob,
    );
    expect(repaired.completedTripWithActiveBookings).toBe(
      before.completedTripWithActiveBookings,
    );
  } finally {
    await f.owner.query('ROLLBACK');
    await f.close();
  }
});
