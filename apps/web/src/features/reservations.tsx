import { useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icon';
import { type Booking, money } from './models';
import { useRemaining } from './remaining';

export function HoldCard({
  booking,
  onChange,
  onReview,
}: {
  booking: Booking;
  onChange: () => void;
  onReview?: () => void;
}) {
  const remaining = useRemaining(booking.expiresAt, booking.serverTime);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const key = useRef<string | null>(null);
  const held =
    booking.status === 'HELD' && (remaining === null || remaining > 0);
  return (
    <article className="booking-card">
      <div className="booking-status">
        <Icon name={held ? 'clock' : 'ticket'} />
        <strong>
          {held
            ? 'Seats reserved'
            : booking.status === 'CANCELLED'
              ? 'Reservation released'
              : 'Reservation expired'}
        </strong>
        {held && remaining !== null && (
          <span className="countdown">
            {Math.floor(remaining / 60)}:
            {String(remaining % 60).padStart(2, '0')}
          </span>
        )}
      </div>
      <h2>
        {booking.origin} → {booking.destination}
      </h2>
      <p>
        Seats {booking.seatLabels.join(', ')} · {money(booking.totalMinor)}
      </p>
      <small className="reference">{booking.reference}</small>
      {onReview && (
        <button className="continue-button" type="button" onClick={onReview}>
          Review reservation
        </button>
      )}
      {held && (
        <>
          <p>
            Your seats will be released when this timer ends. This is not a
            confirmed ticket.
          </p>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={async () => {
              key.current ??= crypto.randomUUID();
              setBusy(true);
              setError('');
              try {
                const response = await fetch(
                  `/api/v1/bookings/${booking.id}/release`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Idempotency-Key': key.current,
                    },
                    body: '{}',
                  },
                );
                if (response.status === 401) {
                  onChange();
                  return;
                }
                if (!response.ok) throw new Error();
                onChange();
              } catch {
                setError('Could not confirm release. Retry safely.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Releasing…' : 'Release seats'}
          </button>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
export function MyBookings({
  signedIn,
  onSignIn,
  onReview,
}: {
  signedIn: boolean;
  onSignIn: () => void;
  onReview: (id: string) => void;
}) {
  const router = useRouter();
  const latestRequest = useRef(0);
  const [bookings, setBookings] = useState<Booking[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/v1/bookings');
      if (requestId !== latestRequest.current) return;
      if (response.status === 401) {
        await router.invalidate();
        return;
      }
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { bookings: Booking[] };
      if (requestId === latestRequest.current) setBookings(data.bookings);
    } catch {
      if (requestId === latestRequest.current)
        setError('Your reservations could not be loaded. Please try again.');
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [router]);
  useEffect(() => {
    if (signedIn) void load();
    const refresh = () => {
      if (signedIn && document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      latestRequest.current++;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [signedIn, load]);
  if (!signedIn)
    return (
      <div className="empty-state">
        <Icon name="ticket" size={40} />
        <h1>Your journeys, in one place</h1>
        <p>Sign in to view and manage your seat reservations.</p>
        <button type="button" onClick={onSignIn}>
          Sign in
        </button>
      </div>
    );
  return (
    <section className="bookings-content">
      <div className="section-heading">
        <h1>My bookings</h1>
        <button
          type="button"
          className="text-button"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>
      {loading ? (
        <p role="status">Loading your reservations…</p>
      ) : error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : bookings.length ? (
        bookings.map((b) => (
          <HoldCard
            key={b.id}
            booking={b}
            onChange={() => void load()}
            onReview={() => onReview(b.id)}
          />
        ))
      ) : (
        <div className="empty-state">
          <Icon name="ticket" size={40} />
          <h2>No reservations yet</h2>
          <p>Find a journey and choose your seats to get started.</p>
        </div>
      )}
    </section>
  );
}
