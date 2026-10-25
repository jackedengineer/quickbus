import { useState } from 'react';
import { Icon } from './icon';
import { dateInIndia, day, money, type Trip, time } from './models';
import type { SearchValues } from './search';
export function TripResults({
  trips,
  search,
  onDay,
  onSelect,
}: {
  trips: Trip[];
  search: SearchValues;
  onDay: (date: string) => void;
  onSelect: (trip: Trip) => void;
}) {
  const [order, setOrder] = useState('departure');
  const matches = trips
    .filter(
      (t) =>
        t.origin === search.from &&
        t.destination === search.to &&
        t.seatCount >= search.adults &&
        dateInIndia(t.departureAt) === search.date,
    )
    .sort((a, b) =>
      order === 'price'
        ? a.fareMinor - b.fareMinor
        : Date.parse(a.departureAt) - Date.parse(b.departureAt),
    );
  return (
    <section className="results-content" aria-label="Search results">
      <div className="date-switcher">
        {[-1, 0, 1].map((offset) => {
          const d = new Date(`${search.date}T12:00:00Z`);
          d.setUTCDate(d.getUTCDate() + offset);
          const date = d.toISOString().slice(0, 10);
          return (
            <button
              type="button"
              key={date}
              aria-pressed={offset === 0}
              disabled={date < dateInIndia(new Date())}
              onClick={() => onDay(date)}
            >
              {day(date)}
            </button>
          );
        })}
      </div>
      <div className="results-tools">
        <h1>
          {matches.length} {matches.length === 1 ? 'result' : 'results'}
        </h1>
        <label>
          Sort by{' '}
          <select value={order} onChange={(e) => setOrder(e.target.value)}>
            <option value="departure">Departure time</option>
            <option value="price">Lowest price</option>
          </select>
        </label>
      </div>
      {matches.length ? (
        matches.map((trip) => {
          const duration = Math.round(
            (Date.parse(trip.arrivalAt) - Date.parse(trip.departureAt)) / 60000,
          );
          return (
            <article className="trip-card" key={trip.id}>
              <div className="trip-overview">
                <div>
                  <strong>{time(trip.departureAt)}</strong>
                  <span>{trip.origin}</span>
                </div>
                <div className="trip-duration">
                  <span>
                    {Math.floor(duration / 60)}:
                    {String(duration % 60).padStart(2, '0')} hrs
                  </span>
                </div>
                <div>
                  <strong>
                    {time(trip.arrivalAt)}
                    {dateInIndia(trip.arrivalAt) !==
                      dateInIndia(trip.departureAt) && <sup>+1 day</sup>}
                  </strong>
                  <span>{trip.destination}</span>
                </div>
                <strong className="trip-price">
                  {money(trip.fareMinor)}
                  <small>per adult</small>
                </strong>
              </div>
              <p className="operator">{trip.operatorName} | AC Seater (2+2)</p>
              <div className="trip-bottom">
                <span className="direct-pill">
                  <Icon name="bus" size={20} />
                  Bus Direct
                </span>
                <span className="seat-count">
                  <Icon name="seat" size={19} />
                  {trip.seatCount} seats total
                </span>
                <button type="button" onClick={() => onSelect(trip)}>
                  Continue
                  <Icon name="chevron" size={24} />
                </button>
              </div>
            </article>
          );
        })
      ) : (
        <div className="empty-state">
          <Icon name="bus" size={42} />
          <h2>No journeys found</h2>
          <p>
            Try another day or route. The preview has a small curated timetable.
          </p>
        </div>
      )}
    </section>
  );
}
