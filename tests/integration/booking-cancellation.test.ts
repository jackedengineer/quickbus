import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { expect, test } from 'vitest';
import {
  cancelCustomerBooking,
  cancellationPreview,
} from '../../packages/backend/src/cancellation';
import { applyPaymentObservation } from '../../packages/backend/src/payment-state';
import { createDatabase } from '../../packages/db/src/client';
import { paymentFixture } from '../support/payments';

async function confirmed() {
  const f = await paymentFixture();
  await f.runtime.db.transaction((tx) =>
    applyPaymentObservation(tx, f.checkout, f.payment, f.keyId),
  );
  return f;
}
test('owned preview, stale-version rejection and concurrent cancellation create one refund intent', async () => {
  const f = await confirmed(),
    peer = createDatabase(
      process.env.DATABASE_URL ?? '',
      process.env.CI_DATABASE_PROXY,
    );
  try {
    const preview = await cancellationPreview(
      f.runtime.db,
      f.users[0].id,
      f.booking,
    );
    expect(preview).toMatchObject({
      eligible: true,
      version: 1,
      policyVersion: 1,
      refundableMinor: 74900,
    });
    expect(
      await cancellationPreview(f.runtime.db, f.users[1].id, f.booking),
    ).toBeNull();
    expect(
      (
        await cancelCustomerBooking(
          f.runtime.db,
          f.users[1].id,
          f.booking,
          randomUUID(),
          1,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await cancelCustomerBooking(
          f.runtime.db,
          f.users[0].id,
          f.booking,
          randomUUID(),
          2,
        )
      ).status,
    ).toBe(412);
    const key = randomUUID();
    const results = await Promise.all([
      cancelCustomerBooking(f.runtime.db, f.users[0].id, f.booking, key, 1),
      cancelCustomerBooking(peer.db, f.users[0].id, f.booking, key, 1),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[1].body).toEqual(results[0].body);
    expect(
      (
        await cancelCustomerBooking(
          peer.db,
          f.users[0].id,
          f.booking,
          randomUUID(),
          1,
        )
      ).status,
    ).toBe(200);
    const audit = (
      await f.owner.query(
        `SELECT b.status,
     (SELECT count(*)::int FROM seat_allocations WHERE booking_id=b.id) allocations,
     (SELECT count(*)::int FROM booking_cancellations WHERE booking_id=b.id) cancellations,
     (SELECT count(*)::int FROM booking_events WHERE booking_id=b.id AND type='CANCELLED') events,
     (SELECT count(*)::int FROM payment_refunds WHERE payment_id=$2) refunds,
     (SELECT count(*)::int FROM booking_notifications WHERE booking_id=b.id AND kind='CANCELLED') notifications
     FROM bookings b WHERE b.id=$1`,
        [f.booking, f.payment.id],
      )
    ).rows[0];
    expect(audit).toEqual({
      status: 'CANCELLED',
      allocations: 0,
      cancellations: 1,
      events: 1,
      refunds: 1,
      notifications: 1,
    });
    expect(
      (
        await f.owner.query(
          'SELECT disposition FROM provider_payments WHERE id=$1',
          [f.payment.id],
        )
      ).rows[0].disposition,
    ).toBe('REFUND');
    expect(
      (
        await cancelCustomerBooking(
          f.runtime.db,
          f.users[0].id,
          f.booking,
          key,
          2,
        )
      ).status,
    ).toBe(422);
  } finally {
    await peer.close();
    await f.close();
  }
});

test('cancellation checks the cutoff after a waited trip lock, not preview or transaction start', async () => {
  const f = await confirmed();
  try {
    await f.owner.query('BEGIN');
    await f.owner.query('SELECT id FROM trips WHERE id=$1 FOR UPDATE', [
      f.trip,
    ]);
    await f.owner.query(
      "UPDATE trips SET departure_at=clock_timestamp()+interval '2 hours 0.8 seconds',sales_close_at=clock_timestamp()+interval '1 hour' WHERE id=$1",
      [f.trip],
    );
    const request = cancelCustomerBooking(
      f.runtime.db,
      f.users[0].id,
      f.booking,
      randomUUID(),
      1,
    );
    await setTimeout(1000);
    await f.owner.query('COMMIT');
    const result = await request;
    expect(result.body.code).toBe('CANCELLATION_CLOSED');
    expect(
      (
        await f.owner.query('SELECT status FROM bookings WHERE id=$1', [
          f.booking,
        ])
      ).rows[0].status,
    ).toBe('CONFIRMED');
    expect(
      (
        await f.owner.query(
          'SELECT booking_id FROM booking_cancellations WHERE booking_id=$1',
          [f.booking],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await f.owner.query('ROLLBACK');
    await f.close();
  }
});
