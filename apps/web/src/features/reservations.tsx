import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icon';
import { type Booking, money } from './models';

function HoldCard({
  booking,
  onChange,
}: {
  booking: Booking;
  onChange: () => void;
}) {
  const [remaining, setRemaining] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const key = useRef<string | null>(null);
  useEffect(() => {
    const start = Date.now(),
      initial = Date.parse(booking.expiresAt) - Date.parse(booking.serverTime);
    const tick = () =>
      setRemaining(
        Math.max(0, Math.ceil((initial - (Date.now() - start)) / 1000)),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [booking.expiresAt, booking.serverTime]);
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
}: {
  signedIn: boolean;
  onSignIn: () => void;
}) {
  const [bookings, setBookings] = useState<Booking[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/v1/bookings');
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { bookings: Booking[] };
      setBookings(data.bookings);
    } catch {
      setError('Your reservations could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (signedIn) void load();
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
          <HoldCard key={b.id} booking={b} onChange={() => void load()} />
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
