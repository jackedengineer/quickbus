import type { TripStop } from '@kwikbus/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from './dialog';
import { Icon } from './icon';
import { money, type Seat, type Trip, time } from './models';
export function SeatPicker({
  trip,
  adults,
  signedIn,
  initialSelected = [],
  initialPickup = '',
  initialDrop = '',
  onSignIn,
  onClose,
  onReserved,
}: {
  trip: Trip;
  adults: number;
  signedIn: boolean;
  initialSelected?: string[];
  initialPickup?: string;
  initialDrop?: string;
  onSignIn: (seats: string[], pickup: string, drop: string) => void;
  onClose: () => void;
  onReserved: (id: string) => void;
}) {
  const [seats, setSeats] = useState<Seat[]>([]),
    [selected, setSelected] = useState<string[]>(initialSelected),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [seatView, setSeatView] = useState<'map' | 'list'>('map');
  const [stops, setStops] = useState<TripStop[]>([]);
  const [pickup, setPickup] = useState(initialPickup),
    [drop, setDrop] = useState(initialDrop);
  const latestLoad = useRef(0);
  const pending = useRef<{ key: string; body: string } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const load = useCallback(
    async (clearMessage = true) => {
      const sequence = ++latestLoad.current;
      setLoading(true);
      if (clearMessage) setMessage('');
      try {
        const [response, detailsResponse] = await Promise.all([
          fetch(`/api/v1/trips/${trip.id}/seats`),
          fetch(`/api/v1/trips/${trip.id}`),
        ]);
        if (sequence !== latestLoad.current) return;
        if (detailsResponse.status === 404) {
          setSeats([]);
          setSelected([]);
          setStops([]);
          setMessage(
            'This journey is no longer available. Please choose another journey.',
          );
          return;
        }
        if (!response.ok || !detailsResponse.ok) throw new Error();
        const data = (await response.json()) as { seats: Seat[] };
        const details = (await detailsResponse.json()) as { stops: TripStop[] };
        if (sequence !== latestLoad.current) return;
        setStops(details.stops);
        setPickup((previous) =>
          details.stops.some((s) => s.id === previous && s.role === 'PICKUP')
            ? previous
            : '',
        );
        setDrop((previous) =>
          details.stops.some((s) => s.id === previous && s.role === 'DROP')
            ? previous
            : '',
        );
        if (data.seats.length === 0)
          setMessage(
            'This journey is no longer available. Please choose another journey.',
          );
        setSeats(data.seats);
        setSelected((previous) =>
          [...new Set(previous)]
            .filter((label) =>
              data.seats.some((seat) => seat.label === label && seat.available),
            )
            .slice(0, adults),
        );
      } catch {
        if (sequence === latestLoad.current)
          setMessage('Seats could not be loaded. Please try again.');
      } finally {
        if (sequence === latestLoad.current) setLoading(false);
      }
    },
    [trip.id, adults],
  );
  useEffect(() => {
    void load();
    return () => {
      latestLoad.current++;
    };
  }, [load]);
  const total = seats
    .filter((s) => selected.includes(s.label))
    .reduce((sum, s) => sum + s.fareMinor, 0);
  async function reserve() {
    if (!signedIn) {
      onSignIn(selected, pickup, drop);
      return;
    }
    pending.current ??= {
      key: crypto.randomUUID(),
      body: JSON.stringify({
        tripId: trip.id,
        seatLabels: selected,
        expectedTotalMinor: total,
        currency: 'INR',
        pickupStopId: pickup,
        dropStopId: drop,
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
        id?: string;
        code?: string;
        detail?: string;
      };
      if (response.status === 201 && data.id) {
        onReserved(data.id);
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
        onSignIn(selected, pickup, drop);
        return;
      }
      setMessage(
        data.detail ??
          'Unable to reserve these seats. Please refresh and try again.',
      );
      await load(false);
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
        {!loading && (
          <div className="stop-choices">
            {(['PICKUP', 'DROP'] as const).map((role) => (
              <label key={role}>
                {role === 'PICKUP' ? 'Pickup point' : 'Drop point'}
                <select
                  name={role === 'PICKUP' ? 'pickupStopId' : 'dropStopId'}
                  value={role === 'PICKUP' ? pickup : drop}
                  disabled={busy || uncertain}
                  onChange={(e) => {
                    pending.current = null;
                    if (role === 'PICKUP') setPickup(e.target.value);
                    else setDrop(e.target.value);
                  }}
                >
                  <option value="">
                    Choose a {role === 'PICKUP' ? 'pickup' : 'drop'} point
                  </option>
                  {stops
                    .filter((s) => s.role === role)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {time(s.scheduledAt)}
                      </option>
                    ))}
                </select>
              </label>
            ))}
            {!stops.length && (
              <p className="error">
                Stops are unavailable for this journey. Please choose another
                journey.
              </p>
            )}
          </div>
        )}
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
        <div
          className="seat-view-switch"
          role="group"
          aria-label="Seat selection view"
        >
          <button
            type="button"
            className="secondary"
            aria-pressed={seatView === 'map'}
            onClick={() => setSeatView('map')}
          >
            Seat map
          </button>
          <button
            type="button"
            className="secondary"
            aria-pressed={seatView === 'list'}
            onClick={() => setSeatView('list')}
          >
            Seat list
          </button>
        </div>
        {loading ? (
          <p role="status">Loading seats…</p>
        ) : seats.length ? (
          <div
            className={
              seatView === 'map' ? 'bus-shell' : 'bus-shell list-shell'
            }
          >
            {seatView === 'map' && (
              <div className="bus-front">
                <Icon name="bus" />
                Front of bus
              </div>
            )}
            <div
              className={seatView === 'map' ? 'seat-grid' : 'seat-list'}
              role="group"
              aria-label="Seats"
            >
              {seats.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  className={s.available ? 'seat' : 'seat unavailable-seat'}
                  aria-label={`Seat ${s.label}, row ${Math.floor((s.position - 1) / 4) + 1}, ${s.position % 4 === 1 || s.position % 4 === 0 ? 'window' : 'aisle'}, ${money(s.fareMinor)}, ${s.available ? 'available' : 'unavailable'}`}
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
                  {seatView === 'map' ? (
                    s.label
                  ) : (
                    <>
                      <strong>{s.label}</strong>
                      <span>
                        Row {Math.floor((s.position - 1) / 4) + 1} ·{' '}
                        {s.position % 4 === 1 || s.position % 4 === 0
                          ? 'Window'
                          : 'Aisle'}
                        <br />
                        {money(s.fareMinor)}
                      </span>
                      <small>
                        {!s.available
                          ? 'Unavailable'
                          : selected.includes(s.label)
                            ? 'Selected'
                            : 'Available'}
                      </small>
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p>No seats are available for this trip.</p>
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
        {message && (
          <p role="alert" className="error">
            {message}
          </p>
        )}
        <button
          type="button"
          disabled={
            loading ||
            busy ||
            !pickup ||
            !drop ||
            seats.length === 0 ||
            selected.length !== adults
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
          Seats stay reserved temporarily. Complete test checkout to confirm.
        </small>
      </div>
    </Dialog>
  );
}
