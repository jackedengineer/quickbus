import type {
  CancellationPreview,
  ReservationReview,
} from '@kwikbus/contracts';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from './dialog';
import { money } from './models';

const deadline = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  dateStyle: 'medium',
  timeStyle: 'short',
});
export function CancellationPanel({
  booking,
  onChange,
}: {
  booking: ReservationReview;
  onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [preview, setPreview] = useState<CancellationPreview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false);
  const pending = useRef<{ key: string; version: number } | null>(null),
    sequence = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, []);
  function close() {
    if (busy && pending.current) return;
    sequence.current++;
    setOpen(false);
    if (uncertain) void onChange();
  }
  async function review() {
    const request = ++sequence.current;
    setOpen(true);
    setPreview(null);
    setError('');
    setBusy(true);
    setUncertain(false);
    pending.current = null;
    try {
      const response = await fetch(
        `/api/v1/bookings/${booking.id}/cancellation`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (!response.ok)
        throw Error(
          'Cancellation details could not be loaded. Close this window and try again.',
        );
      const result = (await response.json()) as CancellationPreview;
      if (mounted.current && request === sequence.current) setPreview(result);
    } catch (cause) {
      if (mounted.current && request === sequence.current)
        setError(
          cause instanceof Error ? cause.message : 'Cancellation unavailable.',
        );
    } finally {
      if (mounted.current && request === sequence.current) setBusy(false);
    }
  }
  async function submit() {
    if (!preview?.eligible || booking.tripCancelled || busy) return;
    pending.current ??= { key: crypto.randomUUID(), version: preview.version };
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/bookings/${booking.id}/cancel`, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': pending.current.key,
          'If-Match': `"${pending.current.version}"`,
        },
        body: JSON.stringify({ policyVersion: 1 }),
      });
      const result = (await response.json()) as {
        detail?: string;
        code?: string;
      };
      if (!mounted.current) return;
      if (response.ok) {
        setOpen(false);
        pending.current = null;
        setUncertain(false);
        await onChange();
        return;
      }
      if (response.status >= 500 || result.code === 'RESOURCE_BUSY') {
        setUncertain(true);
        setError(
          'We could not confirm the cancellation. Retry safely using the same request.',
        );
        return;
      }
      pending.current = null;
      setUncertain(false);
      setPreview({ ...preview, eligible: false });
      setError(
        result.detail ??
          'This booking could not be cancelled. Close this window to check its current status.',
      );
      await onChange();
    } catch {
      if (mounted.current) {
        setUncertain(true);
        setError(
          'The connection was interrupted. Retry cancellation safely, or reopen this booking to check its status.',
        );
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  if ((booking.tripCancelled || booking.status !== 'CONFIRMED') && !open)
    return null;
  return (
    <section className="cancellation-panel" aria-label="Manage booking">
      <h2>Manage your booking</h2>
      <p>
        You can cancel the whole booking for a full test-fare refund until two
        hours before the trip’s first departure.
      </p>
      <button
        type="button"
        className="secondary"
        disabled={booking.tripCancelled}
        onClick={() => void review()}
      >
        Review cancellation
      </button>
      {uncertain && !open && (
        <p role="alert">
          Your cancellation outcome is not confirmed yet. Resume the request
          safely or refresh this booking to check its status.
        </p>
      )}
      {open && (
        <Dialog title="Cancel this booking?" onClose={close}>
          <div className="dialog-content cancellation-preview" aria-busy={busy}>
            {booking.tripCancelled && (
              <p role="status">
                The operator cancelled this trip. Your booking and refund are
                being updated.
              </p>
            )}
            <p>
              <strong>
                {booking.origin} → {booking.destination}
              </strong>
              <br />
              Seats {booking.seatLabels.join(', ')}
            </p>
            {!preview && busy && (
              <p role="status">Checking your cancellation options…</p>
            )}
            {preview && (
              <>
                <p>
                  Cancellation deadline:{' '}
                  <strong>
                    {deadline.format(new Date(preview.cutoffAt))} IST
                  </strong>
                  .
                </p>
                {preview.eligible ? (
                  <>
                    <p className="cancellation-amount">
                      Full test refund:{' '}
                      <strong>{money(preview.refundableMinor)}</strong>
                    </p>
                    <p>
                      All seats in this booking will be released. The refund is
                      processed separately; its progress stays visible in your
                      booking.
                    </p>
                  </>
                ) : (
                  <p>
                    {error
                      ? 'Return to your booking and review the current cancellation options.'
                      : 'Voluntary cancellation is no longer available for this booking.'}
                  </p>
                )}
              </>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="cancellation-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy && Boolean(pending.current)}
                onClick={close}
              >
                {uncertain || !preview?.eligible
                  ? 'Back to booking'
                  : 'Keep booking'}
              </button>
              {preview?.eligible && !booking.tripCancelled && (
                <button
                  type="button"
                  className="cancel-confirm"
                  disabled={busy}
                  onClick={() => void submit()}
                >
                  {busy
                    ? 'Cancelling…'
                    : uncertain
                      ? 'Retry cancellation safely'
                      : 'Cancel booking and request refund'}
                </button>
              )}
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
