import type { SearchPage } from '@kwikbus/contracts';
import { Link } from '@tanstack/react-router';
import { Icon } from './icon';
import { dateInIndia, day, money, time } from './models';
import type { SearchValues } from './search';
export function TripResults({
  page,
  search,
  onDay,
  order,
  onOrder,
  onNext,
  onFirst,
  hasCursor,
  through,
}: {
  page: SearchPage;
  order: 'departure' | 'price';
  onOrder: (order: 'departure' | 'price') => void;
  onNext: () => void;
  onFirst: () => void;
  hasCursor: boolean;
  through: string;
  search: SearchValues;
  onDay: (date: string) => void;
}) {
  const matches = page.trips;
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
              disabled={date < dateInIndia(new Date()) || date > through}
              onClick={() => onDay(date)}
            >
              {day(date)}
            </button>
          );
        })}
      </div>
      <div className="results-sort">
        <label>
          Sort by{' '}
          <select
            name="journeySort"
            value={order}
            onChange={(e) => onOrder(e.target.value as 'departure' | 'price')}
          >
            <option value="departure">Departure time</option>
            <option value="price">Lowest price</option>
          </select>
        </label>
      </div>
      <div className="results-tools">
        <h1>
          {`${matches.length} ${matches.length === 1 ? 'journey' : 'journeys'} on this page`}
        </h1>
      </div>
      {page.detail && (
        <p className="error" role="alert">
          {page.detail}
        </p>
      )}
      {matches.length ? (
        matches.map((trip) => {
          const duration = Math.round(
            (Date.parse(trip.arrivalAt) - Date.parse(trip.departureAt)) / 60000,
          );
          return (
            <article className="trip-card" key={trip.id}>
              <div className="trip-overview">
                <div className="trip-journey">
                  <div className="trip-departure">
                    <div className="departure-time">
                      <strong>{time(trip.departureAt)}</strong>
                      <div className="trip-duration">
                        <span>
                          {Math.floor(duration / 60)}:
                          {String(duration % 60).padStart(2, '0')} hrs
                        </span>
                      </div>
                    </div>
                    <span>{trip.origin}</span>
                  </div>
                  <div className="trip-arrival">
                    <strong>
                      {time(trip.arrivalAt)}
                      {dateInIndia(trip.arrivalAt) !==
                        dateInIndia(trip.departureAt) && <sup>+1 day</sup>}
                    </strong>
                    <span>{trip.destination}</span>
                  </div>
                </div>
                <strong
                  className="trip-price"
                  aria-label={`${money(trip.fareMinor)} per adult`}
                >
                  <span aria-hidden="true">
                    {money(trip.fareMinor).slice(0, -3)}
                    <sup>.{money(trip.fareMinor).slice(-2)}</sup>
                  </span>
                  <small aria-hidden="true">per adult</small>
                </strong>
              </div>
              <p className="operator">
                {trip.operatorName} | {trip.vehicleLabel}
              </p>
              <div className="trip-bottom">
                <span className="direct-pill">
                  <Icon name="bus" size={20} />
                  Bus Direct
                </span>
                <span className="seat-count">
                  <Icon name="seat" size={19} />
                  {trip.availableSeats} seats available
                </span>
                <Link
                  id={`journey-${trip.id}`}
                  className="continue-button"
                  to="/"
                  search={(previous) => ({
                    ...previous,
                    view: 'results',
                    ...search,
                    trip: trip.id,
                  })}
                >
                  Continue
                  <Icon name="chevron" size={24} />
                </Link>
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
      {(page.nextCursor || hasCursor) && (
        <nav className="results-pagination" aria-label="Search pages">
          {hasCursor && (
            <button className="text-button" onClick={onFirst} type="button">
              First page
            </button>
          )}
          {page.nextCursor && (
            <button className="continue-button" onClick={onNext} type="button">
              Next page
            </button>
          )}
        </nav>
      )}
    </section>
  );
}
