import type { Catalog, SearchPage } from '@kwikbus/contracts';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { appendResponseHeader, getRequest } from '@tanstack/react-start/server';
import { useEffect, useState } from 'react';
import { apiFetch } from '../api.server';
import { Dialog } from '../features/dialog';
import { Legal } from '../features/legal';
import { type Session, type Trip } from '../features/models';
import { ReservationReviewScreen } from '../features/reservation-review';
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

const getInitialData = createServerFn({ method: 'GET' })
  .validator(
    (input: {
      from?: string;
      to?: string;
      date?: string;
      adults?: number;
      sort?: string;
      cursor?: string;
      limit?: number;
      results: boolean;
    }) => {
      if (
        Object.values(input).some(
          (v) => typeof v === 'string' && v.length > 1200,
        )
      )
        throw new Error('Invalid search.');
      return input;
    },
  )
  .handler(async ({ data }) => {
    const query = new URLSearchParams();
    for (const field of [
      'from',
      'to',
      'date',
      'adults',
      'sort',
      'cursor',
      'limit',
    ] as const)
      if (data[field] !== undefined) query.set(field, String(data[field]));
    if (data.results)
      for (const field of ['from', 'to', 'date'] as const)
        query.set(field, data[field] ?? '');
    const [sessionResponse, catalogResponse, tripsResponse] = await Promise.all(
      [
        apiFetch(
          new Request('http://kwikbus.internal/api/v1/session', {
            headers: { cookie: getRequest().headers.get('cookie') ?? '' },
          }),
        ),
        apiFetch(new Request('http://kwikbus.internal/api/v1/catalog')),
        data.results
          ? apiFetch(
              new Request(`http://kwikbus.internal/api/v1/trips?${query}`),
            )
          : null,
      ],
    );
    if (
      !sessionResponse.ok ||
      !catalogResponse.ok ||
      (tripsResponse && tripsResponse.status >= 500)
    )
      throw new Error('Journeys are temporarily unavailable.');
    for (const cookie of sessionResponse.headers.getSetCookie())
      appendResponseHeader('Set-Cookie', cookie);
    return {
      session: (await sessionResponse.json()) as Session,
      catalog: (await catalogResponse.json()) as Catalog,
      page: tripsResponse
        ? ((await tripsResponse.json()) as SearchPage)
        : ({ trips: [] } as SearchPage),
    };
  });
type PageSearch = {
  view?: 'results' | 'bookings' | 'help' | 'privacy' | 'terms' | 'review';
  authError?: boolean;
  bookingId?: string;
  pickup?: string;
  drop?: string;
  from?: string;
  to?: string;
  date?: string;
  sort?: 'departure' | 'price';
  cursor?: string;
  limit?: number;
  adults?: number;
  trip?: string;
  seats?: string;
};
export const Route = createFileRoute('/')({
  validateSearch: (input: Record<string, unknown>): PageSearch => ({
    view: [
      'results',
      'bookings',
      'help',
      'privacy',
      'terms',
      'review',
    ].includes(String(input.view))
      ? (input.view as PageSearch['view'])
      : undefined,
    authError:
      input.authError === true || input.authError === 'true' ? true : undefined,
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
    pickup:
      typeof input.pickup === 'string' && /^[0-9a-f-]{36}$/i.test(input.pickup)
        ? input.pickup
        : undefined,
    drop:
      typeof input.drop === 'string' && /^[0-9a-f-]{36}$/i.test(input.drop)
        ? input.drop
        : undefined,
    bookingId:
      typeof input.bookingId === 'string' &&
      /^[0-9a-f-]{36}$/i.test(input.bookingId)
        ? input.bookingId
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
    sort: input.sort === 'price' ? 'price' : undefined,
    cursor:
      typeof input.cursor === 'string' && input.cursor.length <= 1200
        ? input.cursor
        : undefined,
    limit:
      Number.isInteger(Number(input.limit)) &&
      Number(input.limit) >= 1 &&
      Number(input.limit) <= 20
        ? Number(input.limit)
        : undefined,
    adults:
      Number.isInteger(Number(input.adults)) &&
      Number(input.adults) >= 1 &&
      Number(input.adults) <= 4
        ? Number(input.adults)
        : undefined,
  }),
  loaderDeps: ({ search }) => ({
    from: search.from,
    to: search.to,
    date: search.date,
    adults: search.adults,
    sort: search.sort,
    cursor: search.cursor,
    limit: search.limit,
    results: search.view === 'results',
  }),
  loader: ({ deps }) => getInitialData({ data: deps }),
  component: Home,
});
function Home() {
  const router = useRouter();
  const { session, catalog, page } = Route.useLoaderData(),
    search = Route.useSearch(),
    navigate = Route.useNavigate();
  const [accountOpen, setAccountOpen] = useState(Boolean(search.authError));
  const listedTrip = page.trips.find((trip) => trip.id === search.trip) ?? null;
  const [restoredTrip, setRestoredTrip] = useState<Trip | null>(null),
    [tripError, setTripError] = useState('');
  const selectedTrip =
    listedTrip ?? (restoredTrip?.id === search.trip ? restoredTrip : null);
  useEffect(() => {
    if (!search.trip || listedTrip) return;
    const controller = new AbortController();
    setTripError('');
    void (async () => {
      try {
        const response = await fetch(`/api/v1/trips/${search.trip}`, {
          signal: controller.signal,
        });
        if (response.status === 404) {
          if (!controller.signal.aborted) {
            setRestoredTrip(null);
            setTripError(
              'This journey is no longer available. Close this panel and choose another journey.',
            );
          }
          return;
        }
        if (!response.ok) throw new Error();
        const trip = (await response.json()) as Trip;
        if (!controller.signal.aborted) setRestoredTrip(trip);
      } catch {
        if (!controller.signal.aborted)
          setTripError(
            'This journey could not be loaded. Close this panel and search again.',
          );
      }
    })();
    return () => controller.abort();
  }, [search.trip, listedTrip]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void router.invalidate();
    };
    const channel = new BroadcastChannel('kwikbus:session');
    channel.onmessage = refresh;
    // A fresh document after an OAuth callback must also refresh other tabs.
    channel.postMessage('changed');
    const announce = () => channel.postMessage('changed');
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('kwikbus:session', announce);
    return () => {
      channel.close();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('kwikbus:session', announce);
    };
  }, [router]);
  useEffect(() => {
    if (session.user && search.authError) {
      setAccountOpen(false);
      void navigate({
        search: { ...search, authError: undefined },
        replace: true,
      });
    }
  }, [session.user, search, navigate]);
  const values: SearchValues = {
    from: search.from ?? catalog.defaults?.from ?? '',
    to: search.to ?? catalog.defaults?.to ?? '',
    date: search.date ?? catalog.defaults?.date ?? catalog.today,
    adults: search.adults ?? 1,
  };
  const show = (view: PageSearch['view']) => {
    void navigate({
      search: {
        ...search,
        view,
        trip: undefined,
        seats: undefined,
        pickup: undefined,
        drop: undefined,
      },
    });
  };
  const doSearch = (v: SearchValues) =>
    navigate({
      search: { view: 'results', ...v, sort: search.sort, limit: search.limit },
    });
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
        {search.authError && (
          <p className="auth-return-error content-width" role="alert">
            Google sign-in wasn’t completed. Please try again or use email.
          </p>
        )}
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
                  key={`home-${values.from}-${values.to}-${values.date}`}
                  initial={values}
                  catalog={catalog}
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
                catalog={catalog}
                onSearch={doSearch}
              />
            </div>
            <div className="results-background">
              <TripResults
                page={page}
                order={search.sort ?? 'departure'}
                onOrder={(sort) =>
                  void navigate({
                    search: {
                      ...search,
                      sort,
                      cursor: undefined,
                      trip: undefined,
                      seats: undefined,
                    },
                  })
                }
                onNext={() =>
                  void navigate({
                    search: {
                      ...search,
                      cursor: page.nextCursor,
                      trip: undefined,
                      seats: undefined,
                    },
                  })
                }
                onFirst={() =>
                  void navigate({ search: { ...search, cursor: undefined } })
                }
                hasCursor={Boolean(search.cursor)}
                through={catalog.through}
                search={values}
                onDay={(date) => doSearch({ ...values, date })}
              />
            </div>
          </>
        ) : search.view === 'review' && search.bookingId ? (
          <ReservationReviewScreen
            key={`${session.user?.id ?? 'guest'}-${search.bookingId}`}
            id={search.bookingId}
            signedIn={Boolean(session.user)}
            onSignIn={() => setAccountOpen(true)}
            onBack={() => show('bookings')}
          />
        ) : search.view === 'bookings' ? (
          <MyBookings
            key={session.user?.id ?? 'guest'}
            signedIn={Boolean(session.user)}
            onReview={(bookingId) =>
              void navigate({ search: { view: 'review', bookingId } })
            }
            onSignIn={() => setAccountOpen(true)}
          />
        ) : search.view === 'privacy' || search.view === 'terms' ? (
          <Legal kind={search.view} />
        ) : (
          <Help />
        )}
      </main>
      <SiteFooter />
      {search.trip && !selectedTrip && !accountOpen && (
        <Dialog
          title="Journey"
          onClose={() =>
            void navigate({
              search: { ...search, trip: undefined },
              replace: true,
            })
          }
        >
          <div className="dialog-content">
            <p role={tripError ? 'alert' : 'status'}>
              {tripError || 'Loading journey…'}
            </p>
          </div>
        </Dialog>
      )}
      {selectedTrip && !accountOpen && (
        <SeatPicker
          key={selectedTrip.id}
          trip={selectedTrip}
          adults={values.adults}
          signedIn={Boolean(session.user)}
          initialSelected={search.seats?.split(',')}
          initialPickup={search.pickup}
          initialDrop={search.drop}
          onSignIn={async (seats, pickup, drop) => {
            await router.invalidate();
            await navigate({
              search: {
                ...search,
                trip: selectedTrip.id,
                seats: seats.join(','),
                pickup,
                drop,
              },
            });
            setAccountOpen(true);
          }}
          onClose={() => {
            void navigate({
              search: {
                ...search,
                trip: undefined,
                seats: undefined,
                pickup: undefined,
                drop: undefined,
              },
              replace: true,
            });
          }}
          onReserved={(bookingId) => {
            void navigate({ search: { view: 'review', bookingId } });
          }}
        />
      )}
    </>
  );
}
