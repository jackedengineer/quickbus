import { reservationDetailsInput, searchInput } from '@kwikbus/contracts';
import { sql } from '@kwikbus/db/schema';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import express from 'express';
import { z } from 'zod';
import { createAuth, emailSignInEnabled } from './auth';
import {
  getBookings,
  holdSeats,
  listSeats,
  listTrips,
  releaseHold,
} from './booking';
import { catalog, citySuggestions, searchTrips, tripDetails } from './catalog';
import { context } from './context';
import { maintenanceHealth } from './maintenance';
import {
  reservationReview,
  saveReservationDetails,
} from './reservation-details';
import { reportFailure, timed } from './telemetry';

async function readSession(
  request: express.Request,
  response: express.Response,
) {
  const { db, environment } = context();
  const result = await timed('session', () =>
    createAuth(db, environment).api.getSession({
      headers: fromNodeHeaders(request.headers),
      returnHeaders: true,
    }),
  );
  // Better Auth can renew or clear a session while reading it. Preserve those
  // cookie headers through Express, the service binding, and Start SSR.
  for (const cookie of result.headers.getSetCookie())
    response.append('Set-Cookie', cookie);
  return result.response;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.get('/api/health/live', (_request, response) => {
    response.json({ status: 'ok', runtime: 'cloudflare-workers' });
  });
  app.get('/api/health/ready', async (_request, response) => {
    const rows = await context().db.execute(
      sql`select current_setting('server_version_num')::int / 10000 as major`,
    );
    response.json({ status: 'ok', postgresMajor: rows.rows[0]?.major });
  });
  app.get('/api/health/maintenance', async (_request, response) => {
    const health = await maintenanceHealth(context().db);
    response.status(health.status === 'ok' ? 200 : 503).json(health);
  });
  // Auth must see the original body stream: https://better-auth.com/docs/integrations/express
  app.all('/api/auth/*splat', (request, response) => {
    const { db, environment } = context();
    // Expose only the passwordless customer surface. In particular the OTP
    // plugin's password reset and OTP-inspection endpoints stay unreachable.
    const allowed = new Set([
      'POST /api/auth/email-otp/send-verification-otp',
      'POST /api/auth/sign-in/email-otp',
      'POST /api/auth/sign-in/social',
      'POST /api/auth/sign-out',
      'GET /api/auth/callback/google',
      'GET /api/auth/error',
    ]);
    if (!allowed.has(`${request.method} ${request.path}`))
      return response.status(404).json({ code: 'NOT_FOUND' });
    if (request.path.includes('email-otp') && !emailSignInEnabled(environment))
      return response.status(503).json({ code: 'EMAIL_SIGN_IN_UNAVAILABLE' });
    if (
      request.method === 'POST' &&
      request.headers.origin !== environment.APP_ORIGIN
    )
      return response.status(403).json({ code: 'ORIGIN_REJECTED' });
    return toNodeHandler(createAuth(db, environment))(request, response);
  });
  app.get('/api/v1/session', async (request, response) => {
    const { environment } = context();
    const session = await readSession(request, response);
    response.json({
      localMailbox: environment.DEPLOYMENT_ENV === 'local',
      emailEnabled: emailSignInEnabled(environment),
      googleEnabled: Boolean(
        environment.GOOGLE_CLIENT_ID && environment.GOOGLE_CLIENT_SECRET,
      ),
      user: session
        ? {
            id: session.user.id,
            email: session.user.email,
            emailVerified: session.user.emailVerified,
          }
        : null,
    });
  });
  app.use(express.json({ limit: '16kb' }));
  const uuid = z.uuid();
  app.get('/api/v1/catalog', async (_request, response) =>
    response.json(await catalog(context().db)),
  );
  app.get('/api/v1/cities', async (request, response) => {
    const q = z
      .object({ q: z.string().trim().max(100).default('') })
      .strict()
      .safeParse(request.query);
    return q.success
      ? response.json({ cities: await citySuggestions(context().db, q.data.q) })
      : response.status(400).json({ code: 'INVALID_REQUEST' });
  });
  app.get('/api/v1/trips', async (request, response) => {
    if (!Object.keys(request.query).length)
      return response.json({ trips: await listTrips(context().db) });
    const input = searchInput.safeParse(request.query);
    if (!input.success)
      return response.status(400).json({
        trips: [],
        code: 'INVALID_SEARCH',
        detail: 'Choose two cities, a valid date and one to four adults.',
      });
    const result = await searchTrips(context().db, input.data);
    return response.status(result.status).json(result.body);
  });
  app.get('/api/v1/trips/:id', async (request, response) => {
    const id = uuid.safeParse(request.params.id);
    if (!id.success)
      return response.status(400).json({ code: 'INVALID_REQUEST' });
    const trip = await tripDetails(context().db, id.data);
    return trip
      ? response.json(trip)
      : response.status(404).json({ code: 'TRIP_NOT_FOUND' });
  });
  app.get('/api/v1/trips/:id/seats', async (request, response) => {
    const id = uuid.safeParse(request.params.id);
    if (!id.success)
      return response.status(400).json({ code: 'INVALID_REQUEST' });
    return response.json({ seats: await listSeats(context().db, id.data) });
  });
  app.use(
    ['/api/v1/holds', '/api/v1/bookings'],
    async (request, response, next) => {
      const { environment } = context();
      if (
        !['GET', 'HEAD'].includes(request.method) &&
        request.headers.origin !== environment.APP_ORIGIN
      ) {
        response.status(403).json({ code: 'ORIGIN_REJECTED' });
        return;
      }
      const session = await readSession(request, response);
      if (!session?.user.emailVerified) {
        response.status(401).json({ code: 'SIGN_IN_REQUIRED' });
        return;
      }
      response.locals.userId = session.user.id;
      next();
    },
  );
  app.post('/api/v1/holds', async (request, response) => {
    const key = uuid.safeParse(request.headers['idempotency-key']);
    const input = z
      .object({
        tripId: uuid,
        seatLabels: z
          .array(z.string().min(1).max(8))
          .min(1)
          .max(4)
          .refine((s) => new Set(s).size === s.length),
        expectedTotalMinor: z.number().int().positive().max(10000000),
        currency: z.literal('INR'),
        pickupStopId: uuid.optional(),
        dropStopId: uuid.optional(),
      })
      .strict()
      .refine((v) => Boolean(v.pickupStopId) === Boolean(v.dropStopId))
      .safeParse(request.body);
    if (!key.success || !input.success)
      return response.status(400).json({
        code: 'INVALID_REQUEST',
        detail:
          'A UUID request key and one to four distinct seats are required.',
      });
    const result = await holdSeats(
      context().db,
      response.locals.userId,
      key.data,
      input.data,
    );
    return response.status(result.status).json(result.body);
  });
  app.get('/api/v1/bookings', async (_request, response) =>
    response.json({
      bookings: await getBookings(context().db, response.locals.userId),
    }),
  );
  app.get('/api/v1/bookings/:id', async (request, response) => {
    const id = uuid.safeParse(request.params.id);
    if (!id.success)
      return response.status(400).json({ code: 'INVALID_REQUEST' });
    const booking = await reservationReview(
      context().db,
      response.locals.userId,
      id.data,
    );
    return booking
      ? response.json(booking)
      : response.status(404).json({ code: 'BOOKING_NOT_FOUND' });
  });
  app.patch('/api/v1/bookings/:id/details', async (request, response) => {
    const id = uuid.safeParse(request.params.id),
      key = uuid.safeParse(request.headers['idempotency-key']);
    const version = request.headers['if-match'];
    if (version === undefined)
      return response.status(428).json({ code: 'VERSION_REQUIRED' });
    const input = reservationDetailsInput.safeParse(request.body);
    if (
      !id.success ||
      !key.success ||
      typeof version !== 'string' ||
      !/^"[1-9][0-9]{0,8}"$/.test(version) ||
      !input.success
    )
      return response
        .status(400)
        .json({
          code: 'INVALID_DETAILS',
          detail:
            'Enter a name for each seat, valid stops and an optional international phone number.',
        });
    const result = await saveReservationDetails(
      context().db,
      response.locals.userId,
      id.data,
      key.data,
      Number(version.slice(1, -1)),
      input.data,
    );
    return response.status(result.status).json(result.body);
  });
  app.post('/api/v1/bookings/:id/release', async (request, response) => {
    const id = uuid.safeParse(request.params.id),
      key = uuid.safeParse(request.headers['idempotency-key']);
    if (!id.success || !key.success)
      return response.status(400).json({ code: 'INVALID_REQUEST' });
    const result = await releaseHold(
      context().db,
      response.locals.userId,
      key.data,
      id.data,
    );
    return response.status(result.status).json(result.body);
  });
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const cause =
        error && typeof error === 'object' && 'cause' in error
          ? error.cause
          : error;
      const code =
        cause && typeof cause === 'object' && 'code' in cause
          ? cause.code
          : null;
      if (code === '55P03' || code === '57014') {
        response.setHeader('Retry-After', '1');
        response.status(409).json({
          code: 'RESOURCE_BUSY',
          detail: 'This trip is busy. Retry with the same request key.',
        });
        return;
      }
      if (
        error instanceof SyntaxError ||
        (error &&
          typeof error === 'object' &&
          'type' in error &&
          error.type === 'entity.too.large')
      ) {
        response.status(400).json({ code: 'INVALID_REQUEST' });
        return;
      }
      reportFailure(
        'request_failed',
        typeof code === 'string' ? code : undefined,
      );
      response.status(503).json({
        code: 'DEPENDENCY_UNAVAILABLE',
        detail: 'The service is temporarily unavailable. Please retry.',
      });
    },
  );
  return app;
}
