import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { holdSeats, releaseHold } from '../../packages/backend/src/booking';
import { applyPaymentObservation } from '../../packages/backend/src/payment-state';
import { createDatabase } from '../../packages/db/src/client';
import { paymentFixture } from '../support/payments';

test('concurrent capture, replay, older failure and additional capture fulfill once', async () => {
  const f = await paymentFixture();
  const peer = createDatabase(
    process.env.DATABASE_URL ?? '',
    process.env.CI_DATABASE_PROXY,
  );
  try {
    await Promise.all(
      [f.runtime.db, peer.db].map((db) =>
        db.transaction((tx) =>
          applyPaymentObservation(tx, f.checkout, f.payment, f.keyId),
        ),
      ),
    );
    await f.runtime.db.transaction((tx) =>
      applyPaymentObservation(
        tx,
        f.checkout,
        { ...f.payment, status: 'failed', captured: false },
        f.keyId,
      ),
    );
    const audit = (
      await f.owner.query(
        `SELECT b.status,
      (SELECT count(*)::int FROM seat_allocations WHERE booking_id=b.id) allocations,
      (SELECT count(*)::int FROM booking_events WHERE booking_id=b.id AND type='CONFIRMED') events,
      (SELECT state FROM provider_payments WHERE id=$2) payment FROM bookings b WHERE b.id=$1`,
        [f.booking, f.payment.id],
      )
    ).rows[0];
    expect(audit).toEqual({
      status: 'CONFIRMED',
      allocations: 1,
      events: 1,
      payment: 'captured',
    });
    const extra = {
      ...f.payment,
      id: `pay_${randomUUID().replaceAll('-', '')}`,
    };
    for (let i = 0; i < 2; i++)
      await f.runtime.db.transaction((tx) =>
        applyPaymentObservation(tx, f.checkout, extra, f.keyId),
      );
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM payment_refunds WHERE payment_id=$1',
          [extra.id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await f.owner.query(
          "SELECT count(*)::int n FROM provider_payments WHERE intent_id=$1 AND disposition='FULFILLED'",
          [f.intent],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await peer.close();
    await f.close();
  }
});

test('late capture after expiry and reallocation compensates without stealing the seat', async () => {
  const f = await paymentFixture();
  try {
    await f.owner.query(
      "UPDATE bookings SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [f.booking],
    );
    const replacement = await holdSeats(
      f.runtime.db,
      f.users[1].id,
      randomUUID(),
      {
        tripId: f.trip,
        seatLabels: ['1A'],
        expectedTotalMinor: 74900,
        currency: 'INR',
      },
    );
    expect(replacement.status).toBe(201);
    for (let i = 0; i < 2; i++)
      await f.runtime.db.transaction((tx) =>
        applyPaymentObservation(tx, f.checkout, f.payment, f.keyId),
      );
    expect(
      (
        await f.owner.query('SELECT status FROM bookings WHERE id=$1', [
          f.booking,
        ])
      ).rows[0].status,
    ).toBe('EXPIRED');
    expect(
      (
        await f.owner.query(
          'SELECT booking_id FROM seat_allocations WHERE trip_id=$1',
          [f.trip],
        )
      ).rows[0].booking_id,
    ).toBe(replacement.body.id);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM payment_refunds WHERE payment_id=$1',
          [f.payment.id],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await f.close();
  }
});

test('release before capture refunds; mismatched money opens a case and cannot fulfill', async () => {
  const f = await paymentFixture();
  try {
    await f.runtime.db.transaction((tx) =>
      applyPaymentObservation(
        tx,
        f.checkout,
        { ...f.payment, amount: 74899 },
        f.keyId,
      ),
    );
    expect(
      (
        await f.owner.query('SELECT status FROM bookings WHERE id=$1', [
          f.booking,
        ])
      ).rows[0].status,
    ).toBe('PAYMENT_PENDING');
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM payment_cases WHERE checkout_id=$1',
          [f.checkout],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (await f.owner.query('SELECT count(*)::int n FROM payment_refunds'))
        .rows[0].n,
    ).toBe(0);
    await releaseHold(f.runtime.db, f.users[0].id, randomUUID(), f.booking);
    const capture = {
      ...f.payment,
      id: `pay_${randomUUID().replaceAll('-', '')}`,
    };
    await f.runtime.db.transaction((tx) =>
      applyPaymentObservation(tx, f.checkout, capture, f.keyId),
    );
    expect(
      (
        await f.owner.query('SELECT status FROM bookings WHERE id=$1', [
          f.booking,
        ])
      ).rows[0].status,
    ).toBe('CANCELLED');
    expect(
      (
        await f.owner.query(
          'SELECT state FROM payment_refunds WHERE payment_id=$1',
          [capture.id],
        )
      ).rows[0].state,
    ).toBe('PENDING');
  } finally {
    await f.close();
  }
});
