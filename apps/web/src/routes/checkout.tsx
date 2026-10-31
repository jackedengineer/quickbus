import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  type Checkout,
  checkoutSdk,
  type PaymentState,
} from '../features/razorpay-checkout';

// This document is disposable. SDK globals, provider frames and event listeners
// cannot survive a close/reopen or leak into the ticket/history document.
export const Route = createFileRoute('/checkout')({
  validateSearch: (input: Record<string, unknown>) => ({
    bookingId:
      typeof input.bookingId === 'string' &&
      /^[0-9a-f-]{36}$/i.test(input.bookingId)
        ? input.bookingId
        : '',
  }),
  component: HostedCheckout,
});
function HostedCheckout() {
  const { bookingId } = Route.useSearch();
  const [message, setMessage] = useState('Loading secure test checkout…');
  useEffect(() => {
    if (!bookingId || window.parent === window) {
      setMessage('Open checkout from your saved reservation.');
      return;
    }
    let active = true;
    let checkout: Checkout | undefined;
    let checkoutId = '';
    const started = performance.now();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    const send = (kind: string, details = {}) => {
      if (active)
        window.parent.postMessage(
          { type: 'kwikbus:checkout', kind, checkoutId, ...details },
          window.location.origin,
        );
    };
    void (async () => {
      try {
        const response = await fetch(`/api/v1/bookings/${bookingId}/payment`, {
          signal: controller.signal,
        });
        if (!response.ok) throw Error();
        const state = (await response.json()) as PaymentState;
        const c = state.checkout;
        if (!active) return;
        if (
          !c?.canOpen ||
          !c.keyId ||
          !/^rzp_test_[A-Za-z0-9]+$/.test(c.keyId) ||
          !c.orderId ||
          !c.amount ||
          c.currency !== 'INR' ||
          state.mode !== 'test' ||
          !Number.isFinite(state.remainingSeconds)
        )
          throw Error();
        checkoutId = c.id;
        const Razorpay = await checkoutSdk();
        if (!active) return;
        const seconds =
          state.remainingSeconds -
          Math.ceil((performance.now() - started) / 1000);
        if (seconds < 90) throw Error();
        checkout = new Razorpay({
          key: c.keyId,
          order_id: c.orderId,
          amount: c.amount,
          currency: c.currency,
          name: 'KwikBus',
          description: 'Portfolio test reservation',
          timeout: Math.min(600, seconds),
          theme: { color: '#73a800' },
          retry: { enabled: false },
          handler: (result) =>
            send('success', {
              paymentId: result.razorpay_payment_id,
              signature: result.razorpay_signature,
            }),
          modal: { confirm_close: true, ondismiss: () => send('dismissed') },
        });
        checkout.on('payment.failed', () => send('failed'));
        setMessage(
          'If the hosted panel does not load, return to your reservation above. Your existing order is saved.',
        );
        checkout.open();
      } catch {
        if (active)
          setMessage(
            'Checkout could not load. Return to your reservation and refresh payment status before trying again.',
          );
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeout);
      checkout?.close();
    };
  }, [bookingId]);
  return (
    <main id="main" className="checkout-document">
      <p role="status">{message}</p>
    </main>
  );
}
