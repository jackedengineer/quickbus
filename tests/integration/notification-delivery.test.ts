import { afterEach, expect, test, vi } from 'vitest';
import { claimBookingNotification } from '../../packages/backend/src/notification-queue';
import { deliverBookingNotification } from '../../packages/backend/src/notifications';
import { applyPaymentObservation } from '../../packages/backend/src/payment-state';
import { sql } from '../../packages/db/src/schema';
import { paymentFixture } from '../support/payments';

const env = {
  DEPLOYMENT_ENV: 'production',
  APP_ORIGIN: 'https://kwikbus.example',
  EMAIL_FROM: 'KwikBus <demo@kwikbus.example>',
  RESEND_API_KEY: 'fixture-sending-key',
};
afterEach(() => vi.unstubAllGlobals());
async function ready() {
  const f = await paymentFixture();
  await f.owner.query(
    "UPDATE bookings SET contact_email='traveller@kwikbus.test' WHERE id=$1",
    [f.booking],
  );
  await f.runtime.db.transaction((tx) =>
    applyPaymentObservation(tx, f.checkout, f.payment, f.keyId),
  );
  const claim = await claimBookingNotification(f.runtime.db, f.booking);
  if (!claim) throw Error('Missing notification');
  return { ...f, claim };
}

test('lost provider response retries identical payload/key and records one accepted delivery', async () => {
  const f = await ready();
  const calls: { body: unknown; key: unknown }[] = [];
  try {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        calls.push({ body: init.body, key: init.headers['Idempotency-Key'] });
        if (calls.length === 1) throw Error('lost accepted response');
        return Response.json({ id: 'fixture-message-id' });
      }),
    );
    await deliverBookingNotification(f.runtime.db, env, f.claim);
    expect(
      (
        await f.owner.query(
          'SELECT state,provider_id FROM booking_notifications WHERE id=$1',
          [f.claim.id],
        )
      ).rows[0],
    ).toEqual({ state: 'QUEUED', provider_id: null });
    await f.owner.query(
      'UPDATE booking_notifications SET available_at=clock_timestamp() WHERE id=$1',
      [f.claim.id],
    );
    const replacement = await claimBookingNotification(f.runtime.db, f.booking);
    if (!replacement) throw Error('Missing retry');
    await deliverBookingNotification(f.runtime.db, env, replacement);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(
      (
        await f.owner.query(
          'SELECT state,provider_id FROM booking_notifications WHERE id=$1',
          [f.claim.id],
        )
      ).rows[0],
    ).toEqual({ state: 'SENT', provider_id: 'fixture-message-id' });
    await deliverBookingNotification(f.runtime.db, env, f.claim);
    expect(calls).toHaveLength(2);
    expect(
      await claimBookingNotification(f.runtime.db, f.booking),
    ).toBeUndefined();
  } finally {
    await f.close();
  }
});

test('retention expiry and changed message configuration never send again', async () => {
  const f = await ready();
  const send = vi.fn(async () => {
    throw Error('uncertain response');
  });
  vi.stubGlobal('fetch', send);
  try {
    await deliverBookingNotification(f.runtime.db, env, f.claim);
    expect(send).toHaveBeenCalledTimes(1);
    await f.owner.query(
      'UPDATE booking_notifications SET available_at=clock_timestamp() WHERE id=$1',
      [f.claim.id],
    );
    const changed = await claimBookingNotification(f.runtime.db, f.booking);
    if (!changed) throw Error('Missing claim');
    await deliverBookingNotification(
      f.runtime.db,
      { ...env, APP_ORIGIN: 'https://changed.example' },
      changed,
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      (
        await f.owner.query(
          'SELECT failure_code FROM booking_notifications WHERE id=$1',
          [f.claim.id],
        )
      ).rows[0].failure_code,
    ).toBe('CONFIGURATION_CHANGED');
    await f.owner.query(
      "UPDATE booking_notifications SET state='QUEUED',available_at=clock_timestamp(),first_attempt_at=clock_timestamp()-interval '24 hours' WHERE id=$1",
      [f.claim.id],
    );
    const expired = await claimBookingNotification(f.runtime.db, f.booking);
    if (!expired) throw Error('Missing claim');
    await deliverBookingNotification(f.runtime.db, env, expired);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      (
        await f.owner.query(
          'SELECT state,failure_code FROM booking_notifications WHERE id=$1',
          [f.claim.id],
        )
      ).rows[0],
    ).toEqual({ state: 'NEEDS_REVIEW', failure_code: 'DELIVERY_UNCERTAIN' });
  } finally {
    await f.close();
  }
});

test('stale lease cannot acknowledge a send and confirmation rollback/duplicates keep one intent', async () => {
  const f = await ready();
  try {
    await f.runtime.db.transaction((tx) =>
      applyPaymentObservation(tx, f.checkout, f.payment, f.keyId),
    );
    expect(
      (
        await f.owner.query(
          'SELECT id FROM booking_notifications WHERE booking_id=$1',
          [f.booking],
        )
      ).rowCount,
    ).toBe(1);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await f.owner.query(
          "UPDATE booking_notifications SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
          [f.claim.id],
        );
        return Response.json({ id: 'accepted-before-stale-fence' });
      }),
    );
    await deliverBookingNotification(f.runtime.db, env, f.claim);
    expect(
      (
        await f.owner.query(
          'SELECT state,provider_id FROM booking_notifications WHERE id=$1',
          [f.claim.id],
        )
      ).rows[0],
    ).toEqual({ state: 'RUNNING', provider_id: null });
    const replacement = await claimBookingNotification(f.runtime.db, f.booking);
    if (!replacement) throw Error('Missing replacement');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ id: 'accepted-before-stale-fence' })),
    );
    await deliverBookingNotification(f.runtime.db, env, replacement);
    expect(
      (
        await f.owner.query(
          'SELECT state FROM booking_notifications WHERE id=$1',
          [f.claim.id],
        )
      ).rows[0].state,
    ).toBe('SENT');
    // Same business transaction must roll back both capture and notification writes.
    const rolled = await paymentFixture();
    try {
      await expect(
        rolled.runtime.db.transaction(async (tx) => {
          await applyPaymentObservation(
            tx,
            rolled.checkout,
            rolled.payment,
            rolled.keyId,
          );
          await tx.execute(sql`SELECT 1/0`);
        }),
      ).rejects.toThrow();
      expect(
        (
          await rolled.owner.query(
            'SELECT id FROM booking_notifications WHERE booking_id=$1',
            [rolled.booking],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await rolled.close();
    }
  } finally {
    await f.close();
  }
});
