import type { ReservationReview } from '@kwikbus/contracts';
import { money } from './models';

const fullDate = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  dateStyle: 'full',
  timeStyle: 'short',
});
export function BookingTicket({ booking }: { booking: ReservationReview }) {
  const cancelled = booking.status === 'CANCELLED';
  return (
    <article className="booking-ticket" aria-labelledby="ticket-heading">
      <div className="ticket-heading">
        <div>
          <span className="sandbox-badge">TEST MODE · No real travel</span>
          <h2 id="ticket-heading">
            {cancelled ? 'Cancelled demo ticket' : 'Your demo ticket'}
          </h2>
          <p className="ticket-reference">{booking.reference}</p>
        </div>
        <button
          type="button"
          className="secondary ticket-print"
          onClick={() => window.print()}
        >
          Print ticket
        </button>
      </div>
      <h3>
        {booking.origin} → {booking.destination}
      </h3>
      <p>
        {booking.operatorName} · {booking.vehicleLabel}
      </p>
      <p>
        {cancelled
          ? 'This booking is cancelled. See your refund status below.'
          : 'Test booking confirmed. This is a portfolio demonstration, not a travel ticket.'}
      </p>
      <div className="ticket-stops">
        {(['PICKUP', 'DROP'] as const).map((role) => {
          const stop = booking.stops.find(
            (s) =>
              s.id ===
              (role === 'PICKUP' ? booking.pickupStopId : booking.dropStopId),
          );
          return (
            <div key={role}>
              <h3>{role === 'PICKUP' ? 'Boarding' : 'Drop-off'}</h3>
              <p>
                <strong>{stop?.name ?? 'Location not recorded'}</strong>
                <br />
                {fullDate.format(
                  new Date(
                    stop?.scheduledAt ??
                      (role === 'PICKUP'
                        ? booking.departureAt
                        : booking.arrivalAt),
                  ),
                )}{' '}
                IST
              </p>
              {stop && <p>{stop.address}</p>}
            </div>
          );
        })}
      </div>
      <table className="ticket-passengers">
        <caption>Passengers and seats</caption>
        <thead>
          <tr>
            <th scope="col">Passenger</th>
            <th scope="col">Seat</th>
            <th scope="col">Fare</th>
          </tr>
        </thead>
        <tbody>
          {booking.passengers.map((p) => (
            <tr key={p.seatLabel}>
              <td>{p.name ?? 'Name not recorded'}</td>
              <td>{p.seatLabel}</td>
              <td>{money(p.fareMinor)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={2}>
              Total · INR
            </th>
            <td>{money(booking.totalMinor)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="muted">
        All times are in India Standard Time. Sign in to KwikBus to check the
        current booking and refund status.
      </p>
    </article>
  );
}
