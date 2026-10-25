import { useState } from 'react';
import { CityInput } from './city-input';
import { Icon } from './icon';
import { day, type Trip } from './models';
export type SearchValues = {
  from: string;
  to: string;
  date: string;
  adults: number;
};
export function SearchForm({
  initial,
  autoSearch = false,
  trips,
  onSearch,
}: {
  initial: SearchValues;
  autoSearch?: boolean;
  trips: Trip[];
  onSearch: (values: SearchValues) => void;
}) {
  const [values, setValues] = useState(initial);
  const cities = [
    ...new Set(trips.flatMap((t) => [t.origin, t.destination])),
  ].sort();
  const [calendar, setCalendar] = useState(false);
  const [passengers, setPassengers] = useState(false);
  const [month, setMonth] = useState(initial.date.slice(0, 7));
  const [error, setError] = useState('');
  function update(next: SearchValues) {
    setValues(next);
    if (next.from === next.to) {
      setError('Choose two different cities.');
      return;
    }
    setError('');
    if (autoSearch) onSearch(next);
  }
  const changeDay = (offset: number) => {
    const d = new Date(`${values.date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    update({ ...values, date: d.toISOString().slice(0, 10) });
  };
  const first = new Date(`${month}-01T12:00:00Z`),
    days = new Date(
      first.getUTCFullYear(),
      first.getUTCMonth() + 1,
      0,
    ).getDate();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return (
    <form
      className={autoSearch ? 'search-form automatic' : 'search-form'}
      onSubmit={(e) => {
        e.preventDefault();
        if (values.from === values.to) {
          setError('Choose two different cities.');
          return;
        }
        setError('');
        onSearch(values);
      }}
    >
      <fieldset className="trip-type">
        <legend className="sr-only">Trip type</legend>
        <label>
          <input type="radio" name="mode" defaultChecked />
          One Way
        </label>
        <label
          className="unavailable"
          title="Round trips are outside the first release"
        >
          <input type="radio" name="mode" disabled />
          Round Trip
        </label>
      </fieldset>
      <div className="search-fields">
        <div className="route-fields">
          {(['from', 'to'] as const).map((field) => (
            <div className="search-field" key={field}>
              <span>{field === 'from' ? 'From' : 'To'}</span>
              <div className="field-control">
                <Icon name="pin" size={21} />
                <CityInput
                  label={field === 'from' ? 'From' : 'To'}
                  value={values[field]}
                  cities={cities}
                  onChoose={(city) => update({ ...values, [field]: city })}
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            className="swap icon-button"
            aria-label="Swap boarding and dropping location"
            onClick={() =>
              update({ ...values, from: values.to, to: values.from })
            }
          >
            <Icon name="swap" size={21} />
          </button>
        </div>
        <div className="search-field date-field">
          <span>Departure</span>
          <div className="field-control">
            <button
              type="button"
              className="field-button"
              aria-expanded={calendar}
              onClick={() => {
                setCalendar(!calendar);
                setPassengers(false);
              }}
            >
              <Icon name="calendar" size={21} />
              {day(values.date)}
            </button>
            <button
              type="button"
              className="icon-button previous"
              aria-label="Previous day"
              disabled={values.date <= today}
              onClick={() => changeDay(-1)}
            >
              <Icon name="chevron" size={17} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Next day"
              onClick={() => changeDay(1)}
            >
              <Icon name="chevron" size={17} />
            </button>
          </div>
          {calendar && (
            <div className="popover calendar">
              <div className="calendar-heading">
                <button
                  type="button"
                  className="icon-button previous"
                  aria-label="Previous month"
                  onClick={() => {
                    first.setUTCMonth(first.getUTCMonth() - 1);
                    setMonth(first.toISOString().slice(0, 7));
                  }}
                >
                  <Icon name="chevron" size={18} />
                </button>
                <strong>
                  {new Intl.DateTimeFormat('en-IN', {
                    month: 'long',
                    year: 'numeric',
                  }).format(first)}
                </strong>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Next month"
                  onClick={() => {
                    first.setUTCMonth(first.getUTCMonth() + 1);
                    setMonth(first.toISOString().slice(0, 7));
                  }}
                >
                  <Icon name="chevron" size={18} />
                </button>
              </div>
              <div className="calendar-grid">
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                  <span key={`${d}-${i}`}>{d}</span>
                ))}
                {Array.from({ length: (first.getUTCDay() + 6) % 7 }, (_, i) => (
                  <span key={`blank-${i}`} />
                ))}
                {Array.from({ length: days }, (_, i) => {
                  const date = `${month}-${String(i + 1).padStart(2, '0')}`;
                  return (
                    <button
                      type="button"
                      key={date}
                      aria-label={day(date)}
                      aria-pressed={values.date === date}
                      disabled={date < today}
                      onClick={() => {
                        update({ ...values, date });
                        setCalendar(false);
                      }}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="search-field passenger-field">
          <span>Passengers</span>
          <button
            type="button"
            className="field-control field-button"
            aria-expanded={passengers}
            onClick={() => {
              setPassengers(!passengers);
              setCalendar(false);
            }}
          >
            {values.adults} {values.adults === 1 ? 'Adult' : 'Adults'}
            <Icon name="chevron" size={18} style={{ rotate: '90deg' }} />
          </button>
          {passengers && (
            <div className="popover passengers">
              <strong>Adults</strong>
              <span className="muted">18 years and above</span>
              <div className="stepper">
                <button
                  type="button"
                  aria-label="Remove adult"
                  disabled={values.adults === 1}
                  onClick={() =>
                    update({ ...values, adults: values.adults - 1 })
                  }
                >
                  −
                </button>
                <output>{values.adults}</output>
                <button
                  type="button"
                  aria-label="Add adult"
                  disabled={values.adults === 4}
                  onClick={() =>
                    update({ ...values, adults: values.adults + 1 })
                  }
                >
                  +
                </button>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => setPassengers(false)}
              >
                Done
              </button>
            </div>
          )}
        </div>
        <button type="submit" className="search-submit">
          Search
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
