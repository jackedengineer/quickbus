import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { useState } from 'react';
import { apiFetch } from '../api.server';
import { dateInIndia, type Session, type Trip } from '../features/models';
import { MyBookings } from '../features/reservations';
import { SearchForm, type SearchValues } from '../features/search';
import { SeatPicker } from '../features/seat-picker';
import {
  Help,
  LandingContent,
  SiteFooter,
  SiteHeader,
} from '../features/site-shell';
import { TripResults } from '../features/trip-results';

const getInitialData = createServerFn({ method: 'GET' }).handler(async () => {
  const [sessionResponse, tripsResponse] = await Promise.all([
    apiFetch(
      new Request('http://kwikbus.internal/api/v1/session', {
        headers: { cookie: getRequest().headers.get('cookie') ?? '' },
      }),
    ),
    apiFetch(new Request('http://kwikbus.internal/api/v1/trips')),
  ]);
  if (!sessionResponse.ok || !tripsResponse.ok)
    throw new Error('Journeys are temporarily unavailable.');
  return {
    session: (await sessionResponse.json()) as Session,
    trips: ((await tripsResponse.json()) as { trips: Trip[] }).trips,
    today: dateInIndia(new Date()),
  };
});
type PageSearch = {
  view?: 'results' | 'bookings' | 'help';
  from?: string;
  to?: string;
  date?: string;
  adults?: number;
  trip?: string;
  seats?: string;
};
export const Route = createFileRoute('/')({
  validateSearch: (input: Record<string, unknown>): PageSearch => ({
    view: ['results', 'bookings', 'help'].includes(String(input.view))
      ? (input.view as PageSearch['view'])
      : undefined,
    from:
      typeof input.from === 'string' && input.from.length < 100
        ? input.from
        : undefined,
    to:
      typeof input.to === 'string' && input.to.length < 100
        ? input.to
        : undefined,
    date:
      typeof input.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(input.date) &&
      !Number.isNaN(Date.parse(input.date)) &&
      new Date(input.date).toISOString().slice(0, 10) === input.date
        ? input.date
        : undefined,
    trip:
      typeof input.trip === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        input.trip,
      )
        ? input.trip
        : undefined,
    seats:
      typeof input.seats === 'string' &&
      /^[0-9]{1,2}[A-D](,[0-9]{1,2}[A-D]){0,3}$/.test(input.seats)
        ? input.seats
        : undefined,
    adults:
      Number.isInteger(Number(input.adults)) &&
      Number(input.adults) >= 1 &&
      Number(input.adults) <= 4
        ? Number(input.adults)
        : undefined,
  }),
  loader: () => getInitialData(),
  component: Home,
});
function Home() {
  const { session, trips, today } = Route.useLoaderData(),
    search = Route.useSearch(),
    navigate = Route.useNavigate();
  const [accountOpen, setAccountOpen] = useState(false),
    [selectedTrip, setSelectedTrip] = useState<Trip | null>(
      () => trips.find((t) => t.id === search.trip) ?? null,
    );
  const values: SearchValues = {
    from: search.from ?? 'Bengaluru',
    to: search.to ?? 'Hyderabad',
    date: search.date ?? (trips[0] ? dateInIndia(trips[0].departureAt) : today),
    adults: search.adults ?? 1,
  };
  const show = (view: PageSearch['view']) => {
    setSelectedTrip(null);
    void navigate({
      search: { ...search, view, trip: undefined, seats: undefined },
    });
  };
  const doSearch = (v: SearchValues) =>
    void navigate({ search: { view: 'results', ...v } });
  return (
    <>
      <SiteHeader
        session={session}
        compact={search.view === 'results'}
        onHome={() => show(undefined)}
        onBookings={() => show('bookings')}
        onHelp={() => show('help')}
        accountOpen={accountOpen}
        setAccountOpen={setAccountOpen}
      />
      <main id="main">
        {!search.view ? (
          <>
            <section className="hero">
              <div className="hero-image-container">
                <picture>
                  <source
                    srcSet="/reference/hero-desktop.avif"
                    media="(min-width:1200px)"
                  />
                  <source
                    srcSet="/reference/hero-tablet.avif"
                    media="(min-width:600px)"
                  />
                  <img
                    src="/reference/hero-mobile.avif"
                    alt=""
                    fetchPriority="high"
                  />
                </picture>
              </div>
              <div className="hero-content">
                <h1>Book bus tickets online</h1>
                <SearchForm
                  key={`home-${values.date}`}
                  initial={values}
                  trips={trips}
                  onSearch={doSearch}
                />
              </div>
            </section>
            <LandingContent
              onSearch={() => doSearch(values)}
              onHelp={() => show('help')}
            />
          </>
        ) : search.view === 'results' ? (
          <>
            <div className="results-search">
              <SearchForm
                autoSearch
                key={`${values.from}-${values.to}-${values.date}`}
                initial={values}
                trips={trips}
                onSearch={doSearch}
              />
            </div>
            <div className="results-background">
              <TripResults
                trips={trips}
                search={values}
                onDay={(date) => doSearch({ ...values, date })}
                onSelect={setSelectedTrip}
              />
            </div>
          </>
        ) : search.view === 'bookings' ? (
          <MyBookings
            signedIn={Boolean(session.user)}
            onSignIn={() => setAccountOpen(true)}
          />
        ) : (
          <Help />
        )}
      </main>
      <SiteFooter />
      {selectedTrip && !accountOpen && (
        <SeatPicker
          trip={selectedTrip}
          adults={values.adults}
          signedIn={Boolean(session.user)}
          initialSelected={search.seats?.split(',')}
          onSignIn={async (seats) => {
            await navigate({
              search: {
                ...search,
                trip: selectedTrip.id,
                seats: seats.join(','),
              },
            });
            setAccountOpen(true);
          }}
          onClose={() => {
            setSelectedTrip(null);
            void navigate({
              search: { ...search, trip: undefined, seats: undefined },
            });
          }}
          onReserved={() => {
            setSelectedTrip(null);
            show('bookings');
          }}
        />
      )}
    </>
  );
}
