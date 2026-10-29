import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { holdSeats, listSeats } from '../../packages/backend/src/booking';
import { tripDetails } from '../../packages/backend/src/catalog';
import {
  claimPaymentJob,
  StalePaymentLease,
} from '../../packages/backend/src/payment-jobs';
import { applyPaymentObservation } from '../../packages/backend/src/payment-state';
import { paymentStatus } from '../../packages/backend/src/payment-status';
import { runPaymentJobs } from '../../packages/backend/src/payment-worker';
import { saveReservationDetails } from '../../packages/backend/src/reservation-details';
import {
  drainTripCancellation,
  requestTripCancellation,
  tripCancellationStatus,
} from '../../packages/backend/src/trip-cancellation';
import { createCustomers } from '../support/fixtures';
import { paymentFixture } from '../support/payments';

const actor = 'fixture-operator';
test('trip cancellation stops sales immediately, drains bounded batches, replays once and refunds a captured booking', async () => {
  const f = await paymentFixture();
  try {
    await f.runtime.db.transaction((tx) =>
      applyPaymentObservation(tx, f.checkout, f.payment, f.keyId),
    );
    await f.owner.query(
      "INSERT INTO trip_seats(trip_id,seat_label,position,fare_minor) SELECT $1,'extra-'||n,n+1,74900 FROM generate_series(1,4) n",
      [f.trip],
    );
    f.users.push(...(await createCustomers(f.owner, 3)));
    for (let n = 1; n <= 4; n++) {
      expect(
        (
          await holdSeats(f.runtime.db, f.users[n].id, randomUUID(), {
            tripId: f.trip,
            seatLabels: [`extra-${n}`],
            expectedTotalMinor: 74900,
            currency: 'INR',
          })
        ).status,
      ).toBe(201);
    }
    await expect(
      requestTripCancellation(
        f.runtime.db,
        f.trip,
        actor,
        'OPERATOR_CANCELLED',
        4,
      ),
    ).rejects.toThrow('reviewed maximum');
    expect(
      (await tripCancellationStatus(f.runtime.db, f.trip))?.sales_state,
    ).toBe('OPEN');
    await requestTripCancellation(
      f.runtime.db,
      f.trip,
      actor,
      'OPERATOR_CANCELLED',
      5,
    );
    expect(
      (
        await requestTripCancellation(
          f.runtime.db,
          f.trip,
          actor,
          'OPERATOR_CANCELLED',
          5,
        )
      ).alreadyRequested,
    ).toBe(true);
    const unpaid = (
      await f.owner.query(
        'SELECT id FROM bookings WHERE trip_id=$1 AND user_id=$2',
        [f.trip, f.users[1].id],
      )
    ).rows[0].id;
    const edit = await saveReservationDetails(
      f.runtime.db,
      f.users[1].id,
      unpaid,
      randomUUID(),
      1,
      {
        pickupStopId: randomUUID(),
        dropStopId: randomUUID(),
        passengers: [{ seatLabel: 'extra-1', name: 'Stopped trip fixture' }],
        contactPhone: null,
      },
    );
    expect(edit.body.code).toBe('RESERVATION_ENDED');
    expect(await tripDetails(f.runtime.db, f.trip)).toBeNull();
    expect(await listSeats(f.runtime.db, f.trip)).toEqual([]);
    const status = await paymentStatus(
      f.runtime.db,
      {},
      f.users[0].id,
      f.booking,
    );
    expect(status).toMatchObject({ tripCancelled: true, canStart: false });
    expect(
      (
        await holdSeats(f.runtime.db, f.users[0].id, randomUUID(), {
          tripId: f.trip,
          seatLabels: ['extra-1'],
          expectedTotalMinor: 74900,
          currency: 'INR',
        })
      ).status,
    ).toBe(409);
    let job = await claimPaymentJob(f.runtime.db, f.trip);
    expect(job?.kind).toBe('TRIP_CANCEL');
    if (!job) throw Error('Missing job');
    expect(await drainTripCancellation(f.runtime.db, job)).toBe(3);
    expect(await tripCancellationStatus(f.runtime.db, f.trip)).toMatchObject({
      processed_bookings: 3,
      remaining_bookings: 2,
      completed_at: null,
    });
    // Simulate another invocation after the short batch delay.
    await f.owner.query(
      "UPDATE payment_jobs SET available_at=clock_timestamp() WHERE kind='TRIP_CANCEL' AND resource_id=$1",
      [f.trip],
    );
    // No provider credentials: unpaid drain must still progress; no money POST.
    expect(await runPaymentJobs(f.runtime.db, {}, 1, f.trip)).toBe(1);
    const final = await tripCancellationStatus(f.runtime.db, f.trip);
    expect(final).toMatchObject({
      processed_bookings: 5,
      remaining_bookings: 0,
      job_state: 'DONE',
      outstanding_refunds: 1,
    });
    expect(final?.completed_at).not.toBeNull();
    const audit = (
      await f.owner.query(
        `SELECT
      (SELECT count(*)::int FROM seat_allocations WHERE trip_id=$1) allocations,
      (SELECT count(*)::int FROM booking_cancellations WHERE booking_id IN(SELECT id FROM bookings WHERE trip_id=$1) AND source='TRIP') cancellations,
      (SELECT count(*)::int FROM payment_refunds WHERE payment_id=$2) refunds`,
        [f.trip, f.payment.id],
      )
    ).rows[0];
    expect(audit).toEqual({ allocations: 0, cancellations: 5, refunds: 1 });
    // Duplicate captured observation cannot resurrect a cancelled seat.
    await f.runtime.db.transaction((tx) =>
      applyPaymentObservation(tx, f.checkout, f.payment, f.keyId),
    );
    expect(
      (
        await f.owner.query('SELECT status FROM bookings WHERE id=$1', [
          f.booking,
        ])
      ).rows[0].status,
    ).toBe('CANCELLED');
  } finally {
    await f.close();
  }
});

test('a stale drain cannot commit and a replacement lease resumes; late capture is fully compensated', async () => {
  const f = await paymentFixture();
  try {
    await requestTripCancellation(
      f.runtime.db,
      f.trip,
      actor,
      'DEMO_RECOVERY',
      1,
    );
    const stale = await claimPaymentJob(f.runtime.db, f.trip);
    if (!stale) throw Error('Missing job');
    await f.owner.query(
      "UPDATE payment_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [stale.id],
    );
    await expect(
      drainTripCancellation(f.runtime.db, stale),
    ).rejects.toBeInstanceOf(StalePaymentLease);
    expect(
      (await tripCancellationStatus(f.runtime.db, f.trip))?.processed_bookings,
    ).toBe(0);
    // Capture arrives after sales have stopped, before the next drain.
    await f.runtime.db.transaction((tx) =>
      applyPaymentObservation(tx, f.checkout, f.payment, f.keyId),
    );
    expect(
      (
        await f.owner.query(
          'SELECT disposition FROM provider_payments WHERE id=$1',
          [f.payment.id],
        )
      ).rows[0].disposition,
    ).toBe('REFUND');
    const replacement = await claimPaymentJob(f.runtime.db, f.trip);
    if (!replacement) throw Error('Missing replacement');
    await drainTripCancellation(f.runtime.db, replacement);
    expect(await tripCancellationStatus(f.runtime.db, f.trip)).toMatchObject({
      remaining_bookings: 0,
      job_state: 'DONE',
      outstanding_refunds: 1,
    });
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM payment_refunds WHERE payment_id=$1',
          [f.payment.id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM seat_allocations WHERE trip_id=$1',
          [f.trip],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await f.close();
  }
});
