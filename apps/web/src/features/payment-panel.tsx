import type { ReservationReview } from '@kwikbus/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { money } from './models';
import { type Checkout, checkoutSdk } from './razorpay-checkout';

type PaymentState = {
  id: string;
  status: string;
  tripCancelled: boolean;
  enabled: boolean;
  mode: 'test';
  canStart: boolean;
  needsReview: boolean;
  refunds: string[];
  checkout: {
    id: string;
    state: string;
    canOpen: boolean;
    keyId?: string;
    orderId?: string;
    amount?: number;
    currency?: string;
  } | null;
};
export function PaymentPanel({
  booking,
  ready,
  remaining,
  onChange,
}: {
  booking: ReservationReview;
  ready: boolean;
  remaining: number | null;
  onChange: () => void;
}) {
  const [state, setState] = useState<PaymentState | null>(null),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [accepted, setAccepted] = useState(false);
  const pending = useRef<{ key: string; version: number } | null>(null);
  const flight = useRef(false),
    checkoutInstance = useRef<Checkout | null>(null),
    latest = useRef(0),
    onChanged = useRef(onChange),
    bookingStatus = useRef(booking.status),
    currentBooking = useRef(booking.id),
    mounted = useRef(true);
  onChanged.current = onChange;
  bookingStatus.current = booking.status;
  currentBooking.current = booking.id;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const reload = useCallback(async () => {
    if (!mounted.current || currentBooking.current !== booking.id) return;
    const sequence = ++latest.current;
    try {
      const response = await fetch(`/api/v1/bookings/${booking.id}/payment`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? 'Sign in again to check your payment.'
            : 'Payment status could not be loaded.',
        );
      const next = (await response.json()) as PaymentState;
      if (
        sequence !== latest.current ||
        !mounted.current ||
        currentBooking.current !== booking.id
      )
        return;
      setState(next);
      if (
        next.status !== bookingStatus.current ||
        next.tripCancelled !== booking.tripCancelled
      )
        onChanged.current();
    } catch (cause) {
      if (
        sequence === latest.current &&
        mounted.current &&
        currentBooking.current === booking.id
      )
        setError(
          cause instanceof Error
            ? cause.message
            : 'Payment status unavailable.',
        );
    }
  }, [booking.id, booking.tripCancelled]);
  useEffect(() => {
    if (
      state &&
      (state.tripCancelled ||
        ['CONFIRMED', 'EXPIRED', 'CANCELLED'].includes(state.status) ||
        ['FAILED', 'CAPTURED'].includes(state.checkout?.state ?? ''))
    ) {
      const checkout = checkoutInstance.current;
      checkoutInstance.current = null;
      setOpen(false);
      if (checkout) {
        checkout.close();
        // State is already authoritative. Reset the third-party frame before
        // another attempt, and suppress its stale dismissal callback.
        window.location.reload();
      }
    }
  }, [state?.status, state?.checkout?.state, state?.tripCancelled]);
  useEffect(
    () => () => {
      const checkout = checkoutInstance.current;
      checkoutInstance.current = null;
      checkout?.close();
    },
    [booking.id],
  );
  useEffect(() => {
    void reload();
    return () => {
      latest.current++;
    };
  }, [reload, booking.version, booking.status]);
  useEffect(() => {
    const focus = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    const polling =
      (state?.status === 'CONFIRMED' && !state.tripCancelled) ||
      state?.status === 'PAYMENT_PENDING' ||
      ['PENDING', 'CREATING', 'UNKNOWN', 'READY'].includes(
        state?.checkout?.state ?? '',
      ) ||
      state?.refunds.some((s) => !['PROCESSED', 'NEEDS_REVIEW'].includes(s));
    const timer = polling
      ? window.setInterval(focus, state?.status === 'CONFIRMED' ? 15000 : 4000)
      : undefined;
    return () => {
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
      if (timer) window.clearInterval(timer);
    };
  }, [
    reload,
    state?.status,
    state?.checkout?.state,
    state?.tripCancelled,
    state?.refunds.join(','),
  ]);
  const hint = useCallback(
    async (
      checkoutId: string,
      verification?: { paymentId: string; signature: string },
    ) => {
      try {
        const response = await fetch(
          `/api/v1/bookings/${booking.id}/payment/${verification ? 'verify' : 'refresh'}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkoutId, ...verification }),
          },
        );
        if (!response.ok) throw new Error();
      } catch {
        if (mounted.current && currentBooking.current === booking.id)
          setError(
            'Payment verification is pending. Keep this reservation reference and refresh status; do not pay again.',
          );
      }
      await reload();
    },
    [booking.id, reload],
  );
  const launch = useCallback(async () => {
    const c = state?.checkout;
    if (
      flight.current ||
      !c?.canOpen ||
      !c.keyId ||
      !c.orderId ||
      !c.amount ||
      !c.currency ||
      remaining === null ||
      remaining < 90
    )
      return;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      const Razorpay = await checkoutSdk();
      if (!mounted.current || currentBooking.current !== booking.id) return;
      const checkout = new Razorpay({
        key: c.keyId,
        order_id: c.orderId,
        amount: c.amount,
        currency: c.currency,
        name: 'KwikBus',
        description: `Test reservation ${booking.reference}`,
        timeout: Math.min(600, remaining),
        theme: { color: '#73a800' },
        retry: { enabled: false },
        handler: (result) => {
          setOpen(false);
          setNotice(
            'Payment received by checkout. Verifying your reservation…',
          );
          void hint(c.id, {
            paymentId: result.razorpay_payment_id,
            signature: result.razorpay_signature,
          });
        },
        modal: {
          confirm_close: true,
          ondismiss: () => {
            if (
              !mounted.current ||
              currentBooking.current !== booking.id ||
              checkoutInstance.current !== checkout
            )
              return;
            checkoutInstance.current = null;
            setOpen(false);
            setNotice(
              'Checkout closed. We are checking the payment before offering a retry.',
            );
            // The hosted SDK reused a blank frame on a real same-document retry.
            // Frozen details and all financial state are durable; a fresh document
            // resets provider globals without inventing another order or payment.
            void hint(c.id).finally(() => {
              if (mounted.current && currentBooking.current === booking.id)
                window.location.reload();
            });
          },
        },
      });
      checkout.on('payment.failed', () => {
        if (checkoutInstance.current !== checkout) return;
        setOpen(false);
        setNotice(
          'The payment attempt failed. Checking with Razorpay before you try again…',
        );
        void hint(c.id);
      });
      checkoutInstance.current = checkout;
      setOpen(true);
      checkout.open();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Checkout could not open.',
      );
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }, [state?.checkout, remaining, booking.reference, hint]);
  async function start() {
    if (flight.current || !accepted || !ready || !state?.canStart) return;
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('Preparing secure test checkout…');
    // Load while the server prepares the order. Opening remains a direct user
    // click: delayed effect-driven launch left a blank frame in real Chrome.
    void checkoutSdk().catch(() => {});
    pending.current ??= { key: crypto.randomUUID(), version: booking.version };
    try {
      const response = await fetch(`/api/v1/bookings/${booking.id}/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': pending.current.key,
          'If-Match': `"${pending.current.version}"`,
        },
        body: JSON.stringify({ policyAccepted: true }),
      });
      const result = (await response.json()) as {
        detail?: string;
        code?: string;
      };
      if (!response.ok) {
        if (response.status < 500 && result.code !== 'RESOURCE_BUSY')
          pending.current = null;
        throw new Error(
          result.detail ??
            'Checkout preparation could not be confirmed. Retry safely.',
        );
      }
      pending.current = null;
      setNotice('Preparing your Razorpay test order…');
      onChanged.current();
      await reload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Connection interrupted. Retry the same checkout request safely.',
      );
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  if (!state)
    return (
      <section className="payment-panel" aria-label="Payment">
        <p role="status">{error || 'Loading payment options…'}</p>
        <button
          type="button"
          className="text-button"
          onClick={() => void reload()}
        >
          Refresh payment status
        </button>
      </section>
    );
  const confirmed = state.status === 'CONFIRMED' && !state.tripCancelled,
    refunding = state.refunds.length > 0,
    paused =
      !state.enabled && ['HELD', 'PAYMENT_PENDING'].includes(state.status);
  const waiting =
    state.checkout &&
    ['PENDING', 'CREATING', 'UNKNOWN'].includes(state.checkout.state);
  return (
    <section
      className="payment-panel"
      aria-labelledby="payment-heading"
      aria-busy={busy}
    >
      <span className="sandbox-badge">TEST MODE · No real money</span>
      <h2 id="payment-heading">
        {state.tripCancelled && !refunding
          ? 'Trip cancelled'
          : confirmed
            ? 'Test booking confirmed'
            : refunding
              ? 'Your refund status'
              : 'Secure payment'}
      </h2>
      <div role="status" aria-live="polite">
        {confirmed ? (
          <p>
            Your seats are confirmed in this portfolio demo. No real travel
            ticket is issued.
          </p>
        ) : refunding ? (
          <p>
            {state.refunds.every((s) => s === 'PROCESSED')
              ? 'Your test payment has been refunded.'
              : state.refunds.some((s) => s === 'NEEDS_REVIEW')
                ? 'Your refund needs review. Keep your reservation reference.'
                : booking.wasConfirmed && state.status === 'CANCELLED'
                  ? 'Your booking is cancelled. Your full test refund is being processed.'
                  : 'Your seats could not be confirmed. Your test payment is being refunded.'}
          </p>
        ) : state.tripCancelled ? (
          <p>
            The operator cancelled this trip. We are updating your booking and
            checking any payment for a full refund. Do not pay again.
          </p>
        ) : state.needsReview ? (
          <p>
            Payment recovery needs review. Keep your reservation reference and
            do not pay again.
          </p>
        ) : paused ? (
          <p>
            Test checkout is temporarily paused. Your reservation deadline is
            unchanged. Any payment already started is still being checked.
          </p>
        ) : waiting ? (
          <p>
            Checking your existing payment order. Do not start another payment.
          </p>
        ) : state.checkout?.state === 'FAILED' ? (
          <p>Razorpay confirmed the attempt failed. No payment was captured.</p>
        ) : ['CANCELLED', 'EXPIRED'].includes(state.status) ? (
          <p>
            This reservation has ended. Any payment still in progress is being
            checked; a late capture will be refunded.
          </p>
        ) : state.status === 'PAYMENT_PENDING' ? (
          <p>
            Passenger details are saved and locked. We will confirm your seats
            only after payment verification.
          </p>
        ) : (
          <p>
            Save your passenger details, then continue to Razorpay’s hosted test
            checkout.
          </p>
        )}
        {confirmed && refunding && (
          <p>
            {state.refunds.every((s) => s === 'PROCESSED')
              ? 'An additional test payment has been refunded. Your booking remains confirmed.'
              : state.refunds.some((s) => s === 'NEEDS_REVIEW')
                ? 'An additional payment refund needs review. Keep your booking reference and do not pay again.'
                : 'An additional test payment is being refunded. Your booking remains confirmed.'}
          </p>
        )}
        {confirmed && state.needsReview && (
          <p className="error">
            Payment recovery needs review. Keep your booking reference and do
            not pay again.
          </p>
        )}
        {notice &&
          state.enabled &&
          !state.tripCancelled &&
          !confirmed &&
          !refunding &&
          !state.checkout?.canOpen &&
          state.checkout?.state !== 'FAILED' && <p>{notice}</p>}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!confirmed && !refunding && state.canStart && (
        <>
          <label className="payment-consent">
            <input
              type="checkbox"
              name="testPaymentConsent"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            I understand this is a test booking. If payment arrives after my
            seats expire or are released, it will be refunded instead of
            confirming seats.
          </label>
          <button
            type="button"
            className="continue-button"
            disabled={
              !ready ||
              !accepted ||
              busy ||
              open ||
              remaining === null ||
              remaining < 90
            }
            onClick={() => void start()}
          >
            {busy
              ? 'Preparing…'
              : state.checkout?.state === 'FAILED'
                ? `Retry test payment · ${money(booking.totalMinor)}`
                : `Continue to test payment · ${money(booking.totalMinor)}`}
          </button>
          {!ready && (
            <p className="muted">Save your current details before paying.</p>
          )}
        </>
      )}
      {!confirmed && !refunding && state.checkout?.canOpen && (
        <button
          type="button"
          className="continue-button"
          disabled={busy || open || remaining === null || remaining < 90}
          onClick={() => void launch()}
        >
          {open ? 'Checkout open…' : 'Open Razorpay test checkout'}
        </button>
      )}
      {!state.tripCancelled &&
        !confirmed &&
        !refunding &&
        remaining !== null &&
        remaining < 90 && (
          <p>
            The payment-start window has closed. Check status before making
            another reservation.
          </p>
        )}
      {state.checkout && (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => void hint(state.checkout!.id)}
        >
          Refresh payment status
        </button>
      )}
    </section>
  );
}
