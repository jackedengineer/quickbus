import { setTimeout } from 'node:timers/promises';

const origin = 'https://kwikbus.jacked.dev';
const drill = process.argv.includes('--failure-drill');
async function probe(path, validate) {
  const started = performance.now();
  const response = await fetch(new URL(path, origin), {
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'KwikBus-health-monitor' },
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  await validate(response);
  console.log(
    JSON.stringify({
      event: 'health_probe',
      path,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
    }),
  );
}
async function check() {
  if (drill) throw new Error('INTENTIONAL_MONITOR_DRILL');
  await probe('/api/health/ready', async (response) => {
    if ((await response.json()).status !== 'ok')
      throw new Error('DATABASE_NOT_READY');
  });
  await probe('/api/v1/session', async (response) => {
    const session = await response.json();
    if (
      !session.emailEnabled ||
      !session.googleEnabled ||
      session.localMailbox ||
      session.user
    )
      throw new Error('AUTH_CONFIGURATION_INVALID');
  });
  await probe('/api/v1/trips', async (response) => {
    const { trips } = await response.json();
    if (!Array.isArray(trips) || !trips.length)
      throw new Error('NO_SELLABLE_INVENTORY');
  });
  await probe('/', async (response) => {
    if (!response.headers.has('Strict-Transport-Security'))
      throw new Error('HTTPS_POLICY_MISSING');
    if (!(await response.text()).includes('Book bus tickets online'))
      throw new Error('HOME_NOT_RENDERED');
  });
}
let passed = false;
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    await check();
    passed = true;
    break;
  } catch (error) {
    // Only our own bounded error codes are emitted; never response bodies/headers.
    const code =
      error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
        ? error.message
        : 'PROBE_UNAVAILABLE';
    console.error(
      JSON.stringify({
        event: 'health_check_failed',
        attempt,
        code,
        runbook: 'docs/operations.md',
      }),
    );
    if (attempt < 3) await setTimeout(drill ? 10 : 5000);
  }
}
if (!passed) {
  console.error(
    '::error title=KwikBus production health::Three consecutive checks failed. Follow docs/operations.md; do not bypass TLS or alter data.',
  );
  process.exitCode = 1;
}
