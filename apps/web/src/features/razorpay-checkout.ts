type CheckoutSuccess = {
  razorpay_payment_id: string;
  razorpay_signature: string;
};
type CheckoutOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  timeout: number;
  handler: (result: CheckoutSuccess) => void;
  modal: { ondismiss: () => void; confirm_close: boolean };
  retry: { enabled: boolean };
  theme: { color: string };
};
export type PaymentState = {
  id: string;
  status: string;
  tripCancelled: boolean;
  enabled: boolean;
  mode: 'test';
  remainingSeconds: number;
  canStart: boolean;
  needsReview: boolean;
  refunds: string[];
  checkout: {
    id: string;
    state: string;
    canOpen: boolean;
    checking: boolean;
    keyId?: string;
    orderId?: string;
    amount?: number;
    currency?: string;
  } | null;
};
export type CheckoutMessage =
  | { kind: 'success'; paymentId: string; signature: string }
  | { kind: 'dismissed' | 'failed' | 'unavailable' };
export function checkoutMessage(
  data: unknown,
  expectedId: string,
): CheckoutMessage | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if (m.type !== 'kwikbus:checkout' || m.checkoutId !== expectedId) return null;
  if (m.kind === 'success') {
    if (
      typeof m.paymentId !== 'string' ||
      !/^pay_[A-Za-z0-9]{1,50}$/.test(m.paymentId) ||
      typeof m.signature !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(m.signature)
    )
      return null;
    return {
      kind: 'success' as const,
      paymentId: m.paymentId,
      signature: m.signature,
    };
  }
  return m.kind === 'dismissed' ||
    m.kind === 'failed' ||
    m.kind === 'unavailable'
    ? { kind: m.kind }
    : null;
}
export type Checkout = {
  open: () => void;
  close: () => void;
  on: (event: 'payment.failed', listener: () => void) => void;
};
declare global {
  interface Window {
    Razorpay?: new (options: CheckoutOptions) => Checkout;
  }
}
let loading: Promise<void> | undefined;
export async function checkoutSdk() {
  if (window.Razorpay) return window.Razorpay;
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      loading = undefined;
      reject(
        new Error(
          'Checkout could not load. Return to your reservation and try again.',
        ),
      );
    };
    const timer = window.setTimeout(fail, 15000);
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => {
      if (!window.Razorpay) return fail();
      clearTimeout(timer);
      resolve();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  await loading;
  if (!window.Razorpay) throw new Error('Checkout is temporarily unavailable.');
  return window.Razorpay;
}
