import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { checkoutMessage } from '../../apps/web/src/features/razorpay-checkout';

const id = 'active-checkout';
const signature = 'a'.repeat(64);
test('only the active attempt and well-formed provider hints cross the document boundary', () => {
  expect(
    checkoutMessage(
      {
        type: 'kwikbus:checkout',
        checkoutId: id,
        kind: 'success',
        paymentId: 'pay_test123',
        signature,
      },
      id,
    ),
  ).toEqual({ kind: 'success', paymentId: 'pay_test123', signature });
  for (const data of [
    null,
    'success',
    { type: 'other', checkoutId: id, kind: 'dismissed' },
    {
      type: 'kwikbus:checkout',
      checkoutId: 'old-checkout',
      kind: 'success',
      paymentId: 'pay_test123',
      signature,
    },
    { type: 'kwikbus:checkout', checkoutId: id, kind: 'CONFIRMED' },
    {
      type: 'kwikbus:checkout',
      checkoutId: id,
      kind: 'success',
      paymentId: 'pay_test123',
      signature: 'forged',
    },
  ])
    expect(checkoutMessage(data, id)).toBeNull();
  expect(
    checkoutMessage(
      { type: 'kwikbus:checkout', checkoutId: id, kind: 'dismissed' },
      id,
    ),
  ).toEqual({ kind: 'dismissed' });
});
let script: {
  onload?: () => void;
  onerror?: () => void;
  remove: ReturnType<typeof vi.fn>;
};
let append: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  script = { remove: vi.fn() };
  append = vi.fn();
  vi.stubGlobal('window', { setTimeout: globalThis.setTimeout });
  vi.stubGlobal('document', {
    createElement: () => script,
    head: { appendChild: append },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('a missing SDK load settles within fifteen seconds and a retry gets a fresh script', async () => {
  const { checkoutSdk } = await import(
    '../../apps/web/src/features/razorpay-checkout'
  );
  const first = expect(checkoutSdk()).rejects.toThrow(
    'Checkout could not load',
  );
  await vi.advanceTimersByTimeAsync(15000);
  await first;
  expect(script.remove).toHaveBeenCalledOnce();
  const retry = expect(checkoutSdk()).rejects.toThrow(
    'Checkout could not load',
  );
  expect(append).toHaveBeenCalledTimes(2);
  script.onerror?.();
  await retry;
});

test('an onload without the provider constructor is a recoverable failure', async () => {
  const { checkoutSdk } = await import(
    '../../apps/web/src/features/razorpay-checkout'
  );
  const pending = expect(checkoutSdk()).rejects.toThrow(
    'Checkout could not load',
  );
  script.onload?.();
  await pending;
  expect(script.remove).toHaveBeenCalledOnce();
});

test('concurrent SDK requests share one script and loading success cancels the watchdog', async () => {
  const { checkoutSdk } = await import(
    '../../apps/web/src/features/razorpay-checkout'
  );
  const first = checkoutSdk(),
    second = checkoutSdk();
  class Sdk {
    open() {}
    close() {}
    on() {}
  }
  window.Razorpay = Sdk;
  script.onload?.();
  expect(await first).toBe(Sdk);
  expect(await second).toBe(Sdk);
  expect(append).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(16000);
  expect(script.remove).not.toHaveBeenCalled();
});
