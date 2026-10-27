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
type Checkout = {
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
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      loading = undefined;
      reject(new Error('Checkout could not load. Try again.'));
    };
    document.head.appendChild(script);
  });
  await loading;
  if (!window.Razorpay) throw new Error('Checkout is temporarily unavailable.');
  return window.Razorpay;
}
