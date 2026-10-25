import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from './dialog';
import { Icon } from './icon';
import { money, type Seat, type Trip, time } from './models';
export function SeatPicker({
  trip,
  adults,
  signedIn,
  initialSelected = [],
  onSignIn,
  onClose,
  onReserved,
}: {
  trip: Trip;
  adults: number;
  signedIn: boolean;
  initialSelected?: string[];
  onSignIn: (seats: string[]) => void;
  onClose: () => void;
  onReserved: () => void;
}) {
  const [seats, setSeats] = useState<Seat[]>([]),
    [selected, setSelected] = useState<string[]>(initialSelected),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const pending = useRef<{ key: string; body: string } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/trips/${trip.id}/seats`);
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { seats: Seat[] };
      setSeats(data.seats);
      setSelected((previous) =>
        [...new Set(previous)]
          .filter((label) =>
            data.seats.some((seat) => seat.label === label && seat.available),
          )
          .slice(0, adults),
      );
    } catch {
      setMessage('Seats could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [trip.id, adults]);
  useEffect(() => {
    void load();
  }, [load]);
  const total = seats
    .filter((s) => selected.includes(s.label))
    .reduce((sum, s) => sum + s.fareMinor, 0);
  async function reserve() {
    if (!signedIn) {
      onSignIn(selected);
      return;
    }
    pending.current ??= {
      key: crypto.randomUUID(),
      body: JSON.stringify({
        tripId: trip.id,
        seatLabels: selected,
        expectedTotalMinor: total,
        currency: 'INR',
      }),
    };
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/v1/holds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': pending.current.key,
        },
        body: pending.current.body,
      });
      const data = (await response.json()) as {
        code?: string;
        detail?: string;
      };
      if (response.status === 201) {
        onReserved();
        return;
      }
      if (data.code === 'RESOURCE_BUSY' || response.status >= 500) {
        setUncertain(true);
        setMessage(
          'We could not confirm the result yet. Retry safely using the same reservation request.',
        );
        return;
      }
      pending.current = null;
      setUncertain(false);
      if (response.status === 401) {
        onSignIn(selected);
        return;
      }
      setMessage(
        data.detail ??
          'Unable to reserve these seats. Please refresh and try again.',
      );
      setSelected([]);
      await load();
    } catch {
      setUncertain(true);
      setMessage(
        'Connection interrupted. Retry to check the same reservation request.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Choose your seats" onClose={onClose} drawer>
      <div className="drawer-content">
        <p className="journey-summary">
          <strong>
            {trip.origin} → {trip.destination}
          </strong>
          <br />
          {time(trip.departureAt)} · Direct
        </p>
        <p>
          Choose {adults} {adults === 1 ? 'seat' : 'seats'} for your journey.
        </p>
        <div className="seat-legend">
          <span>
            <i />
            Available
          </span>
          <span>
            <i className="chosen" />
            Selected
          </span>
          <span>
            <i className="taken" />
            Unavailable
          </span>
        </div>
        {loading ? (
          <p role="status">Loading seats…</p>
        ) : seats.length ? (
          <div className="bus-shell">
            <div className="bus-front">
              <Icon name="bus" />
              Front of bus
            </div>
            <div className="seat-grid">
              {seats.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  className={s.available ? 'seat' : 'seat unavailable-seat'}
                  aria-label={`Seat ${s.label}, ${money(s.fareMinor)}${s.available ? '' : ', unavailable'}`}
                  aria-pressed={selected.includes(s.label)}
                  disabled={
                    !s.available ||
                    busy ||
                    uncertain ||
                    (!selected.includes(s.label) && selected.length === adults)
                  }
                  onClick={() => {
                    pending.current = null;
                    setSelected(
                      selected.includes(s.label)
                        ? selected.filter((x) => x !== s.label)
                        : [...selected, s.label],
                    );
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p>No seats are available for this trip.</p>
        )}
        {message && (
          <p role="alert" className="error">
            {message}
          </p>
        )}
        <button
          type="button"
          className="text-button"
          disabled={busy || uncertain}
          onClick={() => void load()}
        >
          Refresh seat availability
        </button>
      </div>
      <div className="drawer-footer">
        <div>
          <span>
            {selected.length
              ? `Seats ${selected.join(', ')}`
              : 'No seats selected'}
          </span>
          <strong>{money(total)}</strong>
        </div>
        <button
          type="button"
          disabled={
            loading || busy || seats.length === 0 || selected.length !== adults
          }
          onClick={() => void reserve()}
        >
          {busy
            ? 'Reserving…'
            : uncertain
              ? 'Retry reservation'
              : signedIn
                ? 'Reserve for 10 minutes'
                : 'Sign in to reserve'}
        </button>
        <small>
          Temporary reservation only. Payments are not available yet.
        </small>
      </div>
    </Dialog>
  );
}
