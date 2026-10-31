import type { ReservationReview } from '@kwikbus/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from './dialog';
import { money } from './models';
import { checkoutMessage, type PaymentState } from './razorpay-checkout';

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
    hostedFrame = useRef<HTMLIFrameElement | null>(null),
    activeCheckout = useRef<string | null>(null),
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
      activeCheckout.current = null;
      setOpen(false);
    }
  }, [state?.status, state?.checkout?.state, state?.tripCancelled]);
  useEffect(
    () => () => {
      activeCheckout.current = null;
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
            signal: AbortSignal.timeout(15000),
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
  const leaveCheckout = () => {
    const id = activeCheckout.current;
    activeCheckout.current = null;
    setOpen(false);
    setNotice(
      'Checkout closed. Checking your existing payment before offering a retry.',
    );
    if (id) void hint(id);
  };
  useEffect(() => {
    if (!open) return;
    const receive = (event: MessageEvent) => {
      const source = hostedFrame.current?.contentWindow;
      if (
        !source ||
        event.origin !== window.location.origin ||
        event.source !== source ||
        !activeCheckout.current
      )
        return;
      const id = activeCheckout.current;
      const message = checkoutMessage(event.data, id);
      if (!message) return;
      activeCheckout.current = null;
      setOpen(false);
      setNotice('Checkout finished. Verifying your saved reservation…');
      void hint(
        id,
        message.kind === 'success'
          ? { paymentId: message.paymentId, signature: message.signature }
          : undefined,
      );
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [open, hint]);
  function launch() {
    const c = state?.checkout;
    if (
      flight.current ||
      activeCheckout.current ||
      !c?.canOpen ||
      remaining === null ||
      remaining < 90
    )
      return;
    activeCheckout.current = c.id;
    setError('');
    setOpen(true);
  }
  async function start() {
    if (flight.current || !accepted || !ready || !state?.canStart) return;
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('Preparing secure test checkout…');
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
        signal: AbortSignal.timeout(15000),
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
      {open && (
        <Dialog
          title="Secure test checkout"
          onClose={leaveCheckout}
          className="checkout-shell"
        >
          <div className="checkout-return">
            <p>
              No real money. If the hosted panel does not load, return safely;
              your existing order stays saved.
            </p>
            <button type="button" className="secondary" onClick={leaveCheckout}>
              Return to reservation
            </button>
          </div>
          <iframe
            ref={hostedFrame}
            className="hosted-checkout"
            title="Razorpay test checkout"
            src={`/checkout?bookingId=${booking.id}`}
            allow="payment"
          />
        </Dialog>
      )}
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
