import { expect, test } from 'vitest';
import { applyPaymentObservation } from '../../packages/backend/src/payment-state';
import { reservationReview } from '../../packages/backend/src/reservation-details';
import { paymentFixture } from '../support/payments';

test('confirmation history is server-derived and private to the booking owner', async () => {
  const f = await paymentFixture();
  try {
    expect(
      (await reservationReview(f.runtime.db, f.users[0].id, f.booking))
        ?.wasConfirmed,
    ).toBe(false);
    await f.runtime.db.transaction((tx) =>
      applyPaymentObservation(tx, f.checkout, f.payment, f.keyId),
    );
    const review = await reservationReview(
      f.runtime.db,
      f.users[0].id,
      f.booking,
    );
    expect(review?.status).toBe('CONFIRMED');
    expect(review?.wasConfirmed).toBe(true);
    expect(
      await reservationReview(f.runtime.db, f.users[1].id, f.booking),
    ).toBeNull();
    expect(
      await reservationReview(f.runtime.db, f.users[0].id, crypto.randomUUID()),
    ).toBeNull();
  } finally {
    await f.close();
  }
});
