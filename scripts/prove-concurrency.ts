import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import {
  cleanupFixtures,
  createCustomers,
  createTrip,
  fixtureClient,
} from '../tests/support/fixtures';

const endpoints = ['http://localhost:8787', 'http://localhost:8788'];
const implementationFiles = [
  'apps/api/wrangler.jsonc',
  'apps/web/src/api.server.ts',
  'apps/web/src/routes/api.$.ts',
  'apps/web/src/server.ts',
  'scripts/runtime-grants.ts',
  'pnpm-lock.yaml',
];
for (const directory of [
  'apps/api/src',
  'packages/backend/src',
  'packages/contracts/src',
  'packages/db/src',
  'packages/db/migrations',
]) {
  for (const file of await readdir(directory, { recursive: true })) {
    if (file.endsWith('.ts') || file.endsWith('.sql'))
      implementationFiles.push(`${directory}/${file}`);
  }
}
implementationFiles.sort();
const implementationHash = createHash('sha256');
for (const file of implementationFiles)
  implementationHash
    .update(file)
    .update('\0')
    .update(await readFile(file));
const report: {
  timestamp: string;
  runtime: string;
  database: string;
  scenarios: Record<string, unknown>[];
  implementationSha256: string;
  implementationFiles: string[];
  runtimeRole: string;
} = {
  timestamp: new Date().toISOString(),
  runtimeRole: new URL(process.env.DATABASE_URL ?? '').username,
  implementationSha256: implementationHash.digest('hex'),
  implementationFiles,
  runtime: 'Two separate Wrangler/workerd API instances',
  database: process.env.CI_DATABASE_PROXY
    ? 'Isolated PostgreSQL 18 through Neon WebSocket proxy (no Neon pooler)'
    : 'Neon PostgreSQL 18, pooled WebSocket transactions',
  scenarios: [],
};
const client = await fixtureClient(),
  observer = await fixtureClient();
const tripIds: string[] = [],
  customerIds: string[] = [];
try {
  for (const endpoint of endpoints) {
    const r = await fetch(`${endpoint}/api/health/ready`, {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(r.status, 200);
    assert.equal(
      ((await r.json()) as { postgresMajor: number }).postgresMajor,
      18,
    );
  }
  const customers = await createCustomers(client, 100);
  customerIds.push(...customers.map((c) => c.id));
  async function trip(seats?: string[]) {
    const id = await createTrip(client, seats);
    tripIds.push(id);
    return id;
  }
  let dependencyRetries = 0;
  async function reserve(
    tripId: string,
    index: number,
    seats = ['1A'],
    key = randomUUID(),
    workerIndex = index % 2,
    retryBusy = true,
  ) {
    const body = JSON.stringify({
      tripId,
      seatLabels: seats,
      expectedTotalMinor: 74900 * seats.length,
      currency: 'INR',
    });
    for (let attempt = 0; attempt < 8; attempt++) {
      const response = await fetch(`${endpoints[workerIndex]}/api/v1/holds`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
          Cookie: customers[index].cookie,
          'Idempotency-Key': key,
        },
        body,
        signal: AbortSignal.timeout(25000),
      });
      const result = (await response.json()) as { id?: string; code?: string };
      if (
        retryBusy &&
        (result.code === 'RESOURCE_BUSY' || response.status === 503)
      ) {
        if (response.status === 503) dependencyRetries++;
        await delay(1000 + Math.random() * 400 + attempt * 200);
        continue;
      }
      return { status: response.status, body: result };
    }
    throw new Error('Bounded contention retries exhausted.');
  }
  async function collect<T>(requests: Promise<T>[]) {
    const settled = await Promise.allSettled(requests);
    return settled.map((item) => {
      if (item.status === 'rejected') throw item.reason;
      return item.value;
    });
  }
  async function audit(id: string) {
    return (
      await client.query(
        `SELECT (SELECT count(*)::int FROM bookings WHERE trip_id=$1 AND status='HELD') AS held,(SELECT count(*)::int FROM seat_allocations WHERE trip_id=$1) AS allocations,(SELECT count(*)::int FROM booking_items WHERE trip_id=$1) AS items,(SELECT count(*)::int FROM booking_events WHERE booking_id IN(SELECT id FROM bookings WHERE trip_id=$1)) AS events`,
        [id],
      )
    ).rows[0];
  }
  const last = await trip(['1A']);
  const started = performance.now();
  const keys = customers.map(() => randomUUID());
  const burst = await Promise.allSettled(
    customers.map((_, i) => reserve(last, i, ['1A'], keys[i], i % 2, false)),
  );
  const race = burst.map((r) => {
    if (r.status === 'rejected') throw r.reason;
    return r.value;
  });
  const initialBusy = race.filter(
    (r) => r.body.code === 'RESOURCE_BUSY',
  ).length;
  const burstOutcomes: Record<string, number> = {};
  for (const result of race) {
    const label = `${result.status}:${result.body.code ?? 'SUCCESS'}`;
    burstOutcomes[label] = (burstOutcomes[label] ?? 0) + 1;
  }
  console.log(
    JSON.stringify({ event: 'burst_outcomes', counts: burstOutcomes }),
  );
  assert.ok(
    race.every(
      (r) =>
        r.status === 201 ||
        (r.status === 409 &&
          ['RESOURCE_BUSY', 'SEATS_UNAVAILABLE'].includes(r.body.code ?? '')),
    ),
  );
  console.log(
    `Burst complete: ${initialBusy} bounded busy responses; recovering with original keys.`,
  );
  // Retry in small groups after the simultaneous burst; preserve original keys.
  const unresolved = race
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.body.code === 'RESOURCE_BUSY');
  for (let start = 0; start < unresolved.length; start += 4) {
    await collect(
      unresolved.slice(start, start + 4).map(async ({ index }) => {
        race[index] = await reserve(last, index, ['1A'], keys[index]);
      }),
    );
  }
  console.log(
    'Resolved status counts:',
    Object.fromEntries(
      [...new Set(race.map((r) => `${r.status}:${r.body.code ?? 'HELD'}`))].map(
        (key) => [
          key,
          race.filter((r) => `${r.status}:${r.body.code ?? 'HELD'}` === key)
            .length,
        ],
      ),
    ),
  );
  assert.equal(race.filter((r) => r.status === 201).length, 1);
  assert.equal(
    race.filter((r) => r.status === 409 && r.body.code === 'SEATS_UNAVAILABLE')
      .length,
    99,
  );
  assert.deepEqual(await audit(last), {
    held: 1,
    allocations: 1,
    items: 1,
    events: 1,
  });
  report.scenarios.push({
    name: '100 customers race for the last seat across two instances',
    winners: 1,
    conflicts: 99,
    allocations: 1,
    initialBusy,
    initialUnavailable: 99 - initialBusy,
    recovery: 'Same-key retries after burst, no new holds',
    dependencyRetries,
    elapsedMs: Math.round(performance.now() - started),
  });
  console.log('PASS: last-seat race (1 winner, 99 conflicts)');
  const duplicate = await trip(),
    key = randomUUID();
  const replay = await collect(
    Array.from({ length: 12 }, (_, i) =>
      reserve(duplicate, 0, ['1A', '1B'], key, i % 2),
    ),
  );
  assert.ok(replay.every((r) => r.status === 201));
  assert.equal(new Set(replay.map((r) => r.body.id)).size, 1);
  assert.deepEqual(await audit(duplicate), {
    held: 1,
    allocations: 2,
    items: 2,
    events: 1,
  });
  report.scenarios.push({
    name: '12 concurrent same-key requests',
    responses: 12,
    bookings: 1,
    events: 1,
    allocations: 2,
  });
  console.log('PASS: concurrent idempotency replays');
  const overlap = await trip();
  const parties = await collect([
    reserve(overlap, 0, ['1A', '1B']),
    reserve(overlap, 1, ['1B', '1C']),
  ]);
  assert.equal(parties.filter((r) => r.status === 201).length, 1);
  assert.equal(parties.filter((r) => r.status === 409).length, 1);
  assert.deepEqual(await audit(overlap), {
    held: 1,
    allocations: 2,
    items: 2,
    events: 1,
  });
  report.scenarios.push({
    name: 'Overlapping two-seat parties',
    winners: 1,
    conflicts: 1,
    partialParties: 0,
  });
  console.log('PASS: overlapping parties stay atomic');
  const expired = await trip();
  const old = await reserve(expired, 0, ['1A', '1B']);
  assert.equal(old.status, 201);
  await client.query(
    `UPDATE bookings SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,
    [old.body.id],
  );
  const replacement = await reserve(expired, 1);
  assert.equal(replacement.status, 201);
  assert.equal(
    (
      await client.query('SELECT status FROM bookings WHERE id=$1', [
        old.body.id,
      ])
    ).rows[0].status,
    'EXPIRED',
  );
  assert.deepEqual(await audit(expired), {
    held: 1,
    allocations: 1,
    items: 3,
    events: 3,
  });
  report.scenarios.push({
    name: 'Lazy expiry without scheduler',
    oldBooking: 'EXPIRED',
    replacement: 'HELD',
    allocations: 1,
    unrequestedOldSeatReleased: true,
  });
  console.log('PASS: expired party reclaimed without scheduler');
  async function waitForLock() {
    for (let i = 0; i < 100; i++) {
      const r = await observer.query(
        `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FROM trips WHERE id=%FOR UPDATE%') AS waiting`,
      );
      if (r.rows[0].waiting) return;
      await delay(20);
    }
    throw new Error('Worker did not reach the expected database lock');
  }
  const deadline = await trip();
  await client.query('BEGIN');
  await client.query('SELECT id FROM trips WHERE id=$1 FOR UPDATE', [deadline]);
  const waiting = reserve(deadline, 0);
  try {
    await waitForLock();
    await client.query(
      `UPDATE trips SET sales_close_at=clock_timestamp()+interval '120.5 seconds' WHERE id=$1`,
      [deadline],
    );
    await delay(1000);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    await waiting.catch(() => {});
    throw error;
  }
  const closed = await waiting;
  assert.equal(closed.status, 409);
  assert.equal(closed.body.code, 'SALES_CLOSED');
  assert.deepEqual(await audit(deadline), {
    held: 0,
    allocations: 0,
    items: 0,
    events: 0,
  });
  report.scenarios.push({
    name: 'Sales deadline crossed while waiting for trip lock',
    response: 'SALES_CLOSED',
    allocations: 0,
  });
  console.log('PASS: time is checked after lock acquisition');
  const busyTrip = await trip(),
    busyKey = randomUUID();
  await client.query('BEGIN');
  await client.query('SELECT id FROM trips WHERE id=$1 FOR UPDATE', [busyTrip]);
  const busyResponse = await fetch(`${endpoints[0]}/api/v1/holds`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
      Cookie: customers[0].cookie,
      'Idempotency-Key': busyKey,
    },
    body: JSON.stringify({
      tripId: busyTrip,
      seatLabels: ['1A'],
      expectedTotalMinor: 74900,
      currency: 'INR',
    }),
  });
  await client.query('COMMIT');
  assert.equal(busyResponse.status, 409);
  assert.equal(
    ((await busyResponse.json()) as { code: string }).code,
    'RESOURCE_BUSY',
  );
  const retried = await reserve(busyTrip, 0, ['1A'], busyKey);
  assert.equal(retried.status, 201);
  report.scenarios.push({
    name: 'Bounded lock timeout and safe same-key retry',
    first: 'RESOURCE_BUSY',
    retry: 201,
    allocations: 1,
  });
  console.log('PASS: lock timeout rolls back and same-key retry succeeds');
  const sameUserTrip = await trip();
  const differentKeys = await collect([
    reserve(sameUserTrip, 0, ['1A'], randomUUID(), 0),
    reserve(sameUserTrip, 0, ['1B'], randomUUID(), 1),
  ]);
  assert.equal(differentKeys.filter((r) => r.status === 201).length, 1);
  assert.equal(
    differentKeys.filter((r) => r.body.code === 'ACTIVE_HOLD_EXISTS').length,
    1,
  );
  assert.deepEqual(await audit(sameUserTrip), {
    held: 1,
    allocations: 1,
    items: 1,
    events: 1,
  });
  report.scenarios.push({
    name: 'Same customer, different keys and seats across two instances',
    bookings: 1,
    allocations: 1,
    secondResponse: 'ACTIVE_HOLD_EXISTS',
  });
  console.log(
    'PASS: different keys cannot create two active holds for one customer',
  );
  const faultTrip = await trip(),
    faultKey = randomUUID(),
    faultName = `quickbus_fault_${randomUUID().replaceAll('-', '')}`;
  await client.query(
    `CREATE FUNCTION public.${faultName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.trip_id='${faultTrip}'::uuid AND NEW.seat_label='1B' THEN RAISE EXCEPTION 'quickbus injected rollback'; END IF; RETURN NEW; END $$`,
  );
  try {
    await client.query(
      `CREATE TRIGGER ${faultName} BEFORE INSERT ON seat_allocations FOR EACH ROW EXECUTE FUNCTION public.${faultName}()`,
    );
    const failed = await reserve(
      faultTrip,
      0,
      ['1A', '1B'],
      faultKey,
      0,
      false,
    );
    assert.equal(failed.status, 503);
    assert.deepEqual(await audit(faultTrip), {
      held: 0,
      allocations: 0,
      items: 0,
      events: 0,
    });
    assert.equal(
      (
        await client.query(
          'SELECT count(*)::int AS count FROM idempotency_keys WHERE key=$1',
          [faultKey],
        )
      ).rows[0].count,
      0,
    );
  } finally {
    await client.query(
      `DROP TRIGGER IF EXISTS ${faultName} ON seat_allocations`,
    );
    await client.query(`DROP FUNCTION public.${faultName}()`);
  }
  const recovered = await reserve(faultTrip, 0, ['1A', '1B'], faultKey);
  assert.equal(recovered.status, 201);
  report.scenarios.push({
    name: 'Injected allocation failure after booking and items writes',
    rolledBack: [
      'booking',
      'items',
      'allocations',
      'event',
      'idempotency claim',
    ],
    sameKeyRetry: 201,
  });
  console.log('PASS: injected write failure rolls back the complete command');
  const invariant = await client.query(
    `SELECT
    (SELECT count(*)::int FROM booking_items i JOIN bookings b ON b.id=i.booking_id WHERE b.trip_id=ANY($1::uuid[]) AND b.status='HELD' AND NOT EXISTS(SELECT 1 FROM seat_allocations a WHERE a.booking_id=i.booking_id AND a.trip_id=i.trip_id AND a.seat_label=i.seat_label)) AS missing_allocations,
    (SELECT count(*)::int FROM seat_allocations a JOIN bookings b ON b.id=a.booking_id WHERE a.trip_id=ANY($1::uuid[]) AND b.status<>'HELD') AS terminal_allocations`,
    [tripIds],
  );
  assert.deepEqual(invariant.rows[0], {
    missing_allocations: 0,
    terminal_allocations: 0,
  });
  report.scenarios.push({
    name: 'Independent invariant audit across every scenario',
    ...invariant.rows[0],
  });
  await mkdir('artifacts/local', { recursive: true });
  await writeFile(
    'artifacts/local/concurrency-proof.json',
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    'All concurrency scenarios passed. Evidence: artifacts/local/concurrency-proof.json',
  );
} finally {
  await client.query('ROLLBACK');
  await cleanupFixtures(client, tripIds, customerIds);
  await Promise.all([client.end(), observer.end()]);
}
