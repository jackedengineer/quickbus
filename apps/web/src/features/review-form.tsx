import type { ReservationReview } from '@kwikbus/contracts';
import { dateInIndia, day, money, time } from './models';
export type Draft = {
  pickup: string;
  drop: string;
  phone: string;
  names: Record<string, string>;
};
export function ReservationReviewForm({
  booking,
  draft,
  active,
  busy,
  uncertain,
  conflict,
  loading,
  remaining,
  edit,
  onSave,
}: {
  booking: ReservationReview;
  draft: Draft;
  active: boolean;
  busy: boolean;
  uncertain: boolean;
  conflict: boolean;
  loading: boolean;
  remaining: number | null;
  edit: (draft: Draft) => void;
  onSave: () => Promise<void>;
}) {
  return (
    <form
      className="review-form"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave();
      }}
    >
      <fieldset disabled={!active || busy || uncertain || conflict}>
        <legend>Journey stops</legend>
        {(['PICKUP', 'DROP'] as const).map((role) => (
          <label key={role}>
            {role === 'PICKUP' ? 'Pickup point' : 'Drop point'}
            <select
              required
              value={role === 'PICKUP' ? draft.pickup : draft.drop}
              onChange={(e) =>
                edit({
                  ...draft,
                  [role === 'PICKUP' ? 'pickup' : 'drop']: e.target.value,
                })
              }
            >
              <option value="">
                Choose a {role === 'PICKUP' ? 'pickup' : 'drop'} point
              </option>
              {booking.stops
                .filter((s) => s.role === role)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {time(s.scheduledAt)}
                  </option>
                ))}
            </select>
          </label>
        ))}
        {booking.stops
          .filter((s) => [draft.pickup, draft.drop].includes(s.id))
          .map((s) => (
            <p className="stop-address" key={s.id}>
              <strong>{s.name}</strong>
              <br />
              {day(dateInIndia(s.scheduledAt))} {time(s.scheduledAt)} ·{' '}
              {s.address}
            </p>
          ))}
      </fieldset>
      <fieldset disabled={!active || busy || uncertain || conflict}>
        <legend>Passengers</legend>
        {booking.passengers.map((p) => (
          <label key={p.seatLabel}>
            Full name · Seat {p.seatLabel} · {money(p.fareMinor)}
            <input
              required
              minLength={2}
              maxLength={100}
              autoComplete="off"
              value={draft.names[p.seatLabel]}
              onChange={(e) =>
                edit({
                  ...draft,
                  names: {
                    ...draft.names,
                    [p.seatLabel]: e.target.value,
                  },
                })
              }
            />
          </label>
        ))}
      </fieldset>
      <fieldset disabled={!active || busy || uncertain || conflict}>
        <legend>Contact details</legend>
        <label>
          Verified email
          <input
            type="email"
            value={booking.contactEmail}
            readOnly
            autoComplete="off"
          />
        </label>
        <label>
          Phone (optional, international format)
          <input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="+91 98765 43210"
            maxLength={24}
            value={draft.phone}
            onChange={(e) => edit({ ...draft, phone: e.target.value })}
          />
        </label>
        <p className="muted">
          These details belong only to this reservation. This portfolio demo
          issues no real travel tickets.
        </p>
      </fieldset>
      <div className="review-total">
        <span>
          Total for {booking.passengers.length}{' '}
          {booking.passengers.length === 1 ? 'passenger' : 'passengers'} · INR
        </span>
        <strong>{money(booking.totalMinor)}</strong>
      </div>
      <button
        type="submit"
        className="continue-button"
        disabled={!active || busy || conflict || loading}
      >
        {busy
          ? 'Saving…'
          : uncertain
            ? 'Retry same save'
            : 'Save reservation details'}
      </button>
      <p className="muted">
        A test payment must start with at least 90 seconds left on the
        reservation. Passenger details are locked once checkout starts.
      </p>
      {active && remaining !== null && remaining < 90 && (
        <p role="status">
          Less than 90 seconds remain. You can review details, but this hold
          would be too close to expiry to start a payment.
        </p>
      )}
      {remaining !== null &&
        ['EXPIRED', 'CANCELLED'].includes(booking.status) && (
          <p role="status">
            This reservation has ended. Its seats are no longer held.
          </p>
        )}
    </form>
  );
}
