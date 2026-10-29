import { expect, test } from 'vitest';
import {
  claimBookingNotification,
  enqueueBookingNotification,
} from '../../packages/backend/src/notification-queue';
import { createDatabase } from '../../packages/db/src/client';
import { paymentFixture } from '../support/payments';

test('notification intent rolls back, deduplicates and only one worker owns a lease', async () => {
  const f = await paymentFixture();
  const peer = createDatabase(
    process.env.DATABASE_URL ?? '',
    process.env.CI_DATABASE_PROXY,
  );
  try {
    await expect(
      f.runtime.db.transaction(async (tx) => {
        await enqueueBookingNotification(tx, f.booking, 'CONFIRMED');
        throw new Error('injected rollback');
      }),
    ).rejects.toThrow('injected rollback');
    expect(
      (
        await f.owner.query(
          'SELECT id FROM booking_notifications WHERE booking_id=$1',
          [f.booking],
        )
      ).rowCount,
    ).toBe(0);
    await f.runtime.db.transaction(async (tx) => {
      await enqueueBookingNotification(tx, f.booking, 'CONFIRMED');
      await enqueueBookingNotification(tx, f.booking, 'CONFIRMED');
    });
    const claims = await Promise.all([
      claimBookingNotification(f.runtime.db, f.booking),
      claimBookingNotification(peer.db, f.booking),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const first = claims.find(Boolean);
    if (!first) throw new Error('Missing claim');
    await f.owner.query(
      "UPDATE booking_notifications SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [first.id],
    );
    const next = await claimBookingNotification(f.runtime.db, f.booking);
    expect(next?.id).toBe(first.id);
    expect(next?.leaseToken).not.toBe(first.leaseToken);
    expect(next?.attempts).toBe(2);
    await expect(
      f.owner.query(
        'UPDATE booking_notifications SET first_attempt_at=clock_timestamp(),request_hash=NULL WHERE id=$1',
        [first.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await peer.close();
    await f.close();
  }
});
