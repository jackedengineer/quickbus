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
    /^(DATABASE_URL|CI_DATABASE_PROXY|AUTH_SECRET|APP_ORIGIN|MAILPIT_URL|DEPLOYMENT_ENV|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|RESEND_API_KEY|EMAIL_FROM)=/.test(
      line,
    ),
  )
  .join('\n');
await writeFile('apps/api/.dev.vars', runtimeEnvironment, { mode: 0o600 });
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
  spawn('pnpm', ['--filter', '@kwikbus/web', 'dev'], { stdio: 'inherit' }),
];
function stop() {
  for (const child of children) child.kill('SIGTERM');
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children)
  child.on('exit', (code) => {
    stop();
    process.exitCode = code ?? 1;
  });
