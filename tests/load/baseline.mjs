import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';

const fixturePath = __ENV.FIXTURE || '../../artifacts/local/load/fixture.json';
const trips = new SharedArray(
  'trips',
  () => JSON.parse(open(fixturePath)).trips,
);
const customers = new SharedArray(
  'customers',
  () => JSON.parse(open(fixturePath)).customers,
);
const edge = __ENV.EDGE_FIXTURE === 'true';
const endpoints = edge
  ? [
      'https://kwikbus-load-a.ichiragbhugra.workers.dev',
      'https://kwikbus-load-b.ichiragbhugra.workers.dev',
    ]
  : (__ENV.NEON_FIXTURE === 'true' ? [8791, 8792] : [8787, 8788]).map(
      (port) => `http://host.docker.internal:${port}`,
    );
const loadToken = new SharedArray('run credential', () => [
  JSON.parse(open(fixturePath)).loadToken ?? '',
])[0];
if (edge && !/^[a-f0-9]{64}$/.test(loadToken))
  throw Error('The isolated edge run requires its private fixture credential.');
const duration = __ENV.DURATION || '15m';
const origin = 'http://localhost:3002';
const errors = new Rate('unexpected_errors');
const conflicts = new Counter('business_conflicts');
const searchTime = new Trend('search_ms', true);
const mutationTime = new Trend('mutation_ms', true);
const searchServer = new Trend('search_server_ms', true);
const mutationServer = new Trend('mutation_server_ms', true);
const sessionTime = new Trend('session_ms', true);
const lockTime = new Trend('trip_lock_ms', true);
const missingTiming = new Rate('missing_server_timing');
const transportErrors = new Counter('transport_errors');
const edgeErrors = new Counter('edge_errors');
let failureSamples = 0;
const outcomes = new Counter('outcomes');
export const options = {
  scenarios: {
    reads: {
      executor: 'constant-arrival-rate',
      exec: 'read',
      rate: Number(__ENV.READ_RATE || 45),
      timeUnit: '1s',
      duration,
      preAllocatedVUs: 40,
      maxVUs: 100,
    },
    writes: {
      executor: 'constant-arrival-rate',
      exec: 'write',
      rate: Number(__ENV.WRITE_RATE || 5),
      timeUnit: '1s',
      duration,
      preAllocatedVUs: 15,
      maxVUs: 50,
    },
  },
  thresholds: {
    unexpected_errors: ['rate<0.005'],
    search_ms: ['p(95)<500'],
    mutation_ms: ['p(95)<750'],
    dropped_iterations: ['count==0'],
    search_server_ms: ['p(95)<500'],
    mutation_server_ms: ['p(95)<750'],
    missing_server_timing: ['rate==0'],
  },
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}
function request(method, path, body, customer, name, headers = {}) {
  const endpoint = endpoints[exec.scenario.iterationInTest % 2];
  const response = http.request(
    method,
    endpoint + '/api/v1' + path,
    body && JSON.stringify(body),
    {
      headers: {
        Origin: origin,
        Cookie: customer.cookie,
        'Content-Type': 'application/json',
        ...(edge ? { 'x-kwikbus-load': loadToken } : {}),
        ...headers,
      },
      tags: { name },
      timeout: '15s',
    },
  );
  const business =
    response.status === 409 &&
    ['SEATS_UNAVAILABLE', 'RESOURCE_BUSY', 'ACTIVE_HOLD_EXISTS'].includes(
      response.json('code'),
    );
  if (business) conflicts.add(1);
  const failed = response.status < 200 || (response.status >= 400 && !business);
  if (failed && failureSamples++ < 2)
    console.warn(
      JSON.stringify({
        operation: name,
        status: response.status,
        transportCode: response.error_code,
        edgeCode: response.body?.match(/(?:Error|error code:)\s*(\d{4})/i)?.[1],
        server: response.headers.Server,
        contentType: response.headers['Content-Type'],
        appTiming: Boolean(response.headers['Server-Timing']),
      }),
    );
  if (!response.status) transportErrors.add(1);
  errors.add(failed);
  outcomes.add(1, { operation: name, status: String(response.status) });
  const timing = response.headers['Server-Timing'] ?? '';
  const duration = (metric) => {
    const match = timing.match(
      new RegExp(`(?:^|,\\s*)${metric};dur=([\\d.]+)`),
    );
    return match ? Number(match[1]) : null;
  };
  const api = duration('api');
  if (api === null && response.status) edgeErrors.add(1);
  missingTiming.add(api === null);
  if (api !== null) {
    if (name === 'search') searchServer.add(api);
    if (method !== 'GET') mutationServer.add(api);
  }
  const session = duration('session'),
    lock = duration('tripLock');
  if (session !== null) sessionTime.add(session);
  if (lock !== null) lockTime.add(lock);
  return response;
}
export function read() {
  const i = exec.scenario.iterationInTest;
  // 70% of browse traffic targets the first 20 departures; the rest spreads
  // over 1,000 departures. This keeps a hot subset in the published catalogue.
  const trip =
    trips[__ENV.HOT_TRIP === 'true' ? 0 : i % (i % 10 < 7 ? 20 : trips.length)];
  const customer = customers[exec.vu.idInTest % customers.length];
  switch (i % 10) {
    case 0:
      request('GET', '/catalog', null, customer, 'catalog');
      break;
    case 1:
      request('GET', '/bookings', null, customer, 'owned-bookings');
      break;
    case 2:
    case 3:
      request('GET', `/trips/${trip.id}/seats`, null, customer, 'seats');
      break;
    case 4:
    case 5:
      request('GET', `/trips/${trip.id}`, null, customer, 'trip');
      break;
    default: {
      const r = request(
        'GET',
        `/trips?from=${trip.origin}&to=${trip.destination}&date=${trip.date}&adults=1&sort=departure&limit=10`,
        null,
        customer,
        'search',
      );
      searchTime.add(r.timings.duration);
      break;
    }
  }
}
let held = null;
let saved = false;
let holdKey = uuid();
let detailsKey = uuid();
let releaseKey = uuid();
export function write() {
  const trip =
    trips[__ENV.HOT_TRIP === 'true' ? 0 : exec.vu.idInTest % trips.length];
  const customer = customers[exec.vu.idInTest % customers.length];
  let r;
  if (!held) {
    r = request(
      'POST',
      '/holds',
      {
        tripId: trip.id,
        seatLabels: ['1A'],
        expectedTotalMinor: trip.fare,
        currency: 'INR',
        pickupStopId: trip.pickup,
        dropStopId: trip.drop,
      },
      customer,
      'hold',
      { 'Idempotency-Key': holdKey },
    );
    if (r.status === 201) {
      held = r.json('id');
      saved = false;
      detailsKey = uuid();
      releaseKey = uuid();
    } else if (r.status === 409 && r.json('code') !== 'RESOURCE_BUSY') {
      holdKey = uuid();
    }
  } else if (!saved) {
    r = request(
      'PATCH',
      `/bookings/${held}/details`,
      {
        pickupStopId: trip.pickup,
        dropStopId: trip.drop,
        passengers: [{ seatLabel: '1A', name: 'Load Fixture Traveller' }],
        contactPhone: null,
      },
      customer,
      'details',
      { 'Idempotency-Key': detailsKey, 'If-Match': '"1"' },
    );
    if (r.status === 200) saved = true;
  } else {
    r = request('POST', `/bookings/${held}/release`, {}, customer, 'release', {
      'Idempotency-Key': releaseKey,
    });
    if (r.status === 200) {
      held = null;
      holdKey = uuid();
    }
  }
  mutationTime.add(r.timings.duration);
}
export function handleSummary(data) {
  return {
    [__ENV.SUMMARY || '../../artifacts/local/load/baseline-summary.json']:
      JSON.stringify(data, null, 2),
    stdout:
      JSON.stringify(
        Object.fromEntries(
          [
            'http_reqs',
            'unexpected_errors',
            'search_ms',
            'mutation_ms',
            'search_server_ms',
            'mutation_server_ms',
            'session_ms',
            'trip_lock_ms',
            'business_conflicts',
            'missing_server_timing',
            'transport_errors',
            'edge_errors',
            'dropped_iterations',
          ].map((name) => [name, data.metrics[name]?.values]),
        ),
      ) + '\n',
  };
}
