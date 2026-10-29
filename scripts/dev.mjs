import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const environment = await readFile(
  process.env.KWIKBUS_ENV_FILE ?? '.env',
  'utf8',
);
if (
  !/^DEPLOYMENT_ENV=local$/m.test(environment) ||
  /\/kwikbus_v0(?:[?\n]|$)/m.test(environment)
)
  throw new Error(
    'Development servers require a dedicated local/development database.',
  );
const runtimeEnvironment = environment
  .split('\n')
  .filter((line) =>
    /^(DATABASE_URL|CI_DATABASE_PROXY|AUTH_SECRET|APP_ORIGIN|MAILPIT_URL|DEPLOYMENT_ENV|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|RESEND_API_KEY|EMAIL_FROM|RAZORPAY_KEY_ID|RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET|PAYMENTS_ENABLED)=/.test(
      line,
    ),
  )
  .join('\n');
await writeFile('apps/api/.dev.vars', runtimeEnvironment, { mode: 0o600 });
const webPort = process.env.KWIKBUS_WEB_PORT ?? '3000';
if (!/^[0-9]{4,5}$/.test(webPort) || Number(webPort) > 65535)
  throw new Error('Use a local web port between 1000 and 65535.');
const children = [
  spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      '-c',
      'apps/api/wrangler.jsonc',
      '--port',
      '8787',
      '--ip',
      '127.0.0.1',
    ],
    { stdio: 'inherit' },
  ),
  spawn(
    'pnpm',
    [
      '--filter',
      '@kwikbus/web',
      'exec',
      'vite',
      '--port',
      webPort,
      '--host',
      '127.0.0.1',
    ],
    { stdio: 'inherit' },
  ),
];
// Wrangler exposes local scheduled events but does not run production crons.
// Keep the real sandbox journey recoverable while the development app is open.
// The isolated CI environment has payments disabled and drives its own clock.
let cronRunning = false;
const cronTimer = /^PAYMENTS_ENABLED=true$/m.test(environment)
  ? setInterval(async () => {
      if (cronRunning) return;
      cronRunning = true;
      try {
        const response = await fetch(
          'http://127.0.0.1:8787/cdn-cgi/local/scheduled?cron=*+*+*+*+*&format=json',
          { signal: AbortSignal.timeout(55000) },
        );
        if (!response.ok)
          console.error('Local scheduled payment recovery failed.');
      } catch {
        console.error('Local scheduled payment recovery unavailable.');
      } finally {
        cronRunning = false;
      }
    }, 60000)
  : undefined;
function stop() {
  clearInterval(cronTimer);
  for (const child of children) child.kill('SIGTERM');
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children)
  child.on('exit', (code) => {
    stop();
    process.exitCode = code ?? 1;
  });
