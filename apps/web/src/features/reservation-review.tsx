import type { ReservationReview } from '@kwikbus/contracts';
import { useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookingTicket } from './booking-ticket';
import { CancellationPanel } from './cancellation-panel';
import { dateInIndia, day, time } from './models';
import { PaymentPanel } from './payment-panel';
import { useRemaining } from './remaining';
import { HoldCard } from './reservations';
import { type Draft, ReservationReviewForm } from './review-form';

export function ReservationReviewScreen({
  id,
  signedIn,
  onSignIn,
  onBack,
}: {
  id: string;
  signedIn: boolean;
  onSignIn: () => void;
  onBack: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [id]);
  const router = useRouter(),
    latest = useRef(0),
    dirty = useRef(false),
    version = useRef(0);
  const pending = useRef<{ key: string; body: string; version: number } | null>(
    null,
  );
  const [booking, setBooking] = useState<ReservationReview | null>(null),
    [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const load = useCallback(
    async (replace = false) => {
      const sequence = ++latest.current;
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/v1/bookings/${id}`);
        if (sequence !== latest.current) return;
        if (response.status === 401) {
          await router.invalidate();
          return;
        }
        if (response.status === 404)
          throw new Error('Reservation not found for this account.');
        if (!response.ok)
          throw new Error('Reservation could not be loaded. Try again.');
        const next = (await response.json()) as ReservationReview;
        if (sequence !== latest.current) return;
        if (dirty.current && !replace) {
          if (next.version !== version.current) {
            setConflict(true);
            setNotice(
              'Details changed in another tab. Your draft is still here. Reload saved details before editing.',
            );
          }
          setBooking((previous) =>
            previous
              ? {
                  ...previous,
                  status: next.status,
                  expiresAt: next.expiresAt,
                  serverTime: next.serverTime,
                }
              : next,
          );
        } else {
          setBooking(next);
          version.current = next.version;
          dirty.current = false;
          pending.current = null;
          setDraft({
            pickup: next.pickupStopId ?? '',
            drop: next.dropStopId ?? '',
            phone: next.contactPhone ?? '',
            names: Object.fromEntries(
              next.passengers.map((p) => [p.seatLabel, p.name ?? '']),
            ),
          });
          setConflict(false);
          setUncertain(false);
        }
      } catch (cause) {
        if (sequence === latest.current)
          setError(
            cause instanceof Error ? cause.message : 'Reservation unavailable.',
          );
      } finally {
        if (sequence === latest.current) setLoading(false);
      }
    },
    [id, router],
  );
  useEffect(() => {
    if (signedIn) void load();
    const refresh = () => {
      if (
        signedIn &&
        !pending.current &&
        document.visibilityState === 'visible'
      )
        void load();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      latest.current++;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [signedIn, load]);
  useEffect(() => {
    if (
      !['QUEUED', 'RUNNING'].includes(booking?.confirmationEmail ?? '') &&
      !(
        booking?.tripCancelled &&
        ['HELD', 'PAYMENT_PENDING', 'CONFIRMED'].includes(booking.status)
      )
    )
      return;
    const refresh = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 15000);
    return () => clearInterval(refresh);
  }, [
    booking?.confirmationEmail,
    booking?.tripCancelled,
    booking?.status,
    load,
  ]);
  const remaining = useRemaining(
    booking?.expiresAt ?? '',
    booking?.serverTime ?? '',
  );
  const active =
    !booking?.tripCancelled &&
    booking?.status === 'HELD' &&
    remaining !== null &&
    remaining > 0;
  const edit = (next: Draft) => {
    dirty.current = true;
    pending.current = null;
    setDraft(next);
    setNotice('');
  };
  async function save() {
    if (!booking || !draft || !active || conflict) return;
    const phone = draft.phone.replace(/[\s()-]/g, '');
    if (phone && !/^[+][1-9][0-9]{6,14}$/.test(phone)) {
      setError(
        'Use an international phone number, for example +91 followed by 10 digits, or leave it blank.',
      );
      return;
    }
    const passengers = booking.passengers.map((p) => ({
      seatLabel: p.seatLabel,
      name: draft.names[p.seatLabel].trim(),
    }));
    if (
      passengers.some(
        (p) =>
          p.name.length < 2 ||
          p.name.length > 100 ||
          /[\p{Cc}\p{Cs}]/u.test(p.name),
      )
    ) {
      setError('Enter a name of 2–100 characters for every seat.');
      return;
    }
    pending.current ??= {
      key: crypto.randomUUID(),
      version: booking.version,
      body: JSON.stringify({
        pickupStopId: draft.pickup,
        dropStopId: draft.drop,
        passengers,
        contactPhone: phone || null,
      }),
    };
    setBusy(true);
    setError('');
    setNotice('');
    latest.current++;
    try {
      const response = await fetch(`/api/v1/bookings/${id}/details`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': pending.current.key,
          'If-Match': `"${pending.current.version}"`,
        },
        body: pending.current.body,
      });
      const result = (await response.json()) as {
        detail?: string;
        code?: string;
      };
      if (response.ok) {
        dirty.current = false;
        pending.current = null;
        setUncertain(false);
        await load(true);
        setNotice(
          'Reservation details saved. The original reservation deadline is unchanged.',
        );
        return;
      }
      if (response.status >= 500 || result.code === 'RESOURCE_BUSY') {
        setUncertain(true);
        setError(
          'We could not confirm the save. Retry the same details safely.',
        );
        return;
      }
      pending.current = null;
      setUncertain(false);
      if (response.status === 401) {
        await router.invalidate();
        return;
      }
      if (response.status === 412) setConflict(true);
      setError(
        result.detail ??
          'Details could not be saved. Check your entries and try again.',
      );
      if (response.status === 409) await load();
    } catch {
      setUncertain(true);
      setError(
        'Connection interrupted. Retry safely to confirm the same save.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (!signedIn)
    return (
      <section className="empty-state">
        <h1>Sign in to review your reservation</h1>
        <button type="button" onClick={onSignIn}>
          Sign in
        </button>
      </section>
    );
  return (
    <section className="bookings-content review-content">
      <div className="section-heading">
        <h1 ref={heading} tabIndex={-1}>
          {booking?.wasConfirmed ? 'Your booking' : 'Review reservation'}
        </h1>
        <button type="button" className="text-button" onClick={onBack}>
          My bookings
        </button>
      </div>
      {loading && !booking && <p role="status">Loading reservation…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="review-notice" role="status">
          {notice}
        </p>
      )}
      {booking && draft && (
        <>
          {booking.wasConfirmed ? (
            <BookingTicket booking={booking} />
          ) : (
            <HoldCard booking={booking} onChange={() => void load(true)} />
          )}
          {!booking.wasConfirmed && (
            <>
              <p className="muted">
                {booking.operatorName} · {booking.vehicleLabel} ·{' '}
                {day(dateInIndia(booking.departureAt))}{' '}
                {time(booking.departureAt)}
              </p>
              {!booking.complete && (
                <p>
                  Complete the passenger and contact details for this
                  reservation.
                </p>
              )}
              {conflict && (
                <p role="alert">
                  A newer version is saved. Reloading will replace this draft.
                </p>
              )}
              <button
                type="button"
                className="text-button"
                disabled={busy || loading}
                onClick={() => {
                  setNotice('');
                  void load(true);
                }}
              >
                Reload saved details
              </button>
              <ReservationReviewForm
                booking={booking}
                draft={draft}
                active={Boolean(active)}
                busy={busy}
                uncertain={uncertain}
                conflict={conflict}
                loading={loading}
                remaining={remaining}
                edit={edit}
                onSave={save}
              />
            </>
          )}
          <CancellationPanel booking={booking} onChange={() => load(true)} />
          <PaymentPanel
            key={booking.id}
            booking={booking}
            ready={
              booking.complete &&
              !dirty.current &&
              !busy &&
              !conflict &&
              !uncertain
            }
            remaining={remaining}
            onChange={() => void load(true)}
          />
        </>
      )}
      {!booking && !loading && (
        <button
          type="button"
          className="secondary"
          onClick={() => void load(true)}
        >
          Try again
        </button>
      )}
    </section>
  );
}
