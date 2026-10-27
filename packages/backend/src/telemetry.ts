import { AsyncLocalStorage } from 'node:async_hooks';

type Timing = 'binding' | 'session' | 'email' | 'command' | 'tripLock';
type Telemetry = {
  requestId: string;
  service: 'web' | 'api';
  route: string;
  timings: Partial<Record<Timing, number>>;
};
const store = new AsyncLocalStorage<Telemetry>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const routes = new Set([
  '/api/health/live',
  '/api/health/ready',
  '/api/health/maintenance',
  '/api/v1/session',
  '/api/v1/trips',
  '/api/v1/catalog',
  '/api/v1/cities',
  '/api/v1/holds',
  '/api/v1/bookings',
  '/api/webhooks/razorpay',
  '/api/auth/email-otp/send-verification-otp',
  '/api/auth/sign-in/email-otp',
  '/api/auth/sign-in/social',
  '/api/auth/sign-out',
  '/api/auth/callback/google',
  '/api/auth/error',
]);
export function routeLabel(path: string) {
  if (routes.has(path)) return path;
  if (/^\/api\/v1\/trips\/[^/]+\/seats$/.test(path))
    return '/api/v1/trips/:id/seats';
  if (/^\/api\/v1\/trips\/[^/]+$/.test(path)) return '/api/v1/trips/:id';
  if (/^\/api\/v1\/bookings\/[^/]+\/details$/.test(path))
    return '/api/v1/bookings/:id/details';
  if (/^\/api\/v1\/bookings\/[^/]+\/release$/.test(path))
    return '/api/v1/bookings/:id/release';
  for (const action of [
    'checkout',
    'payment',
    'payment/verify',
    'payment/refresh',
  ])
    if (new RegExp(`^/api/v1/bookings/[^/]+/${action}$`).test(path))
      return `/api/v1/bookings/:id/${action}`;
  if (/^\/api\/v1\/bookings\/[^/]+$/.test(path)) return '/api/v1/bookings/:id';
  if (path.startsWith('/_server/') || path.startsWith('/_serverFn/'))
    return '/_server/:function';
  return path === '/' ? '/' : 'other';
}
export function requestId() {
  return store.getStore()?.requestId;
}
export function reportFailure(
  event: 'request_failed' | 'worker_dependency_failed',
  databaseCode?: string,
) {
  const value = store.getStore();
  console.error(
    JSON.stringify({
      event,
      databaseCode:
        databaseCode && /^[A-Z0-9]{5}$/.test(databaseCode)
          ? databaseCode
          : undefined,
      requestId: value?.requestId,
      service: value?.service,
      route: value?.route,
    }),
  );
}
export async function timed<T>(
  name: Timing,
  operation: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  let ok = false;
  try {
    const result = await operation();
    ok = true;
    return result;
  } finally {
    const value = store.getStore();
    const durationMs = Math.round((performance.now() - started) * 10) / 10;
    if (value) {
      value.timings[name] = (value.timings[name] ?? 0) + durationMs;
      console[ok ? 'log' : 'error'](
        JSON.stringify({
          event: 'dependency_completed',
          requestId: value.requestId,
          service: value.service,
          dependency: name,
          durationMs,
          ok,
        }),
      );
    }
  }
}
export async function observeRequest(
  request: Request,
  service: 'web' | 'api',
  operation: () => Response | Promise<Response>,
) {
  // Public clients cannot select the trace identity. The private API accepts only
  // the UUID created by the web Worker, never arbitrary header/log content.
  const incoming = request.headers.get('X-Request-Id') ?? '';
  const value: Telemetry = {
    requestId:
      service === 'api' && uuid.test(incoming) ? incoming : crypto.randomUUID(),
    service,
    route: routeLabel(new URL(request.url).pathname),
    timings: {},
  };
  return store.run(value, async () => {
    const started = performance.now();
    let status = 503;
    try {
      const result = await operation();
      status = result.status;
      const response = new Response(result.body, result);
      response.headers.set('X-Request-Id', value.requestId);
      const timings = Object.entries(value.timings).map(
        ([key, duration]) => `${key};dur=${duration?.toFixed(1)}`,
      );
      timings.push(
        `${service};dur=${(performance.now() - started).toFixed(1)}`,
      );
      response.headers.append('Server-Timing', timings.join(', '));
      return response;
    } finally {
      console[status >= 500 ? 'error' : 'log'](
        JSON.stringify({
          event: 'request_completed',
          requestId: value.requestId,
          service,
          route: value.route,
          method: ['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS'].includes(
            request.method,
          )
            ? request.method
            : 'other',
          status,
          durationMs: Math.round((performance.now() - started) * 10) / 10,
        }),
      );
    }
  });
}
