import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadTarget } from './load-target';

if (!process.argv.includes('--neon'))
  throw Error('Edge configuration requires an isolated Neon load database.');
const { directory } = loadTarget();
const fixture = JSON.parse(await readFile(`${directory}/fixture.json`, 'utf8'));
const secret = process.env.AUTH_SECRET;
if (!secret || secret.length < 32)
  throw Error('Use the fixture-specific authentication secret.');
const token = randomBytes(32).toString('hex');
await writeFile(
  `${directory}/fixture.json`,
  JSON.stringify({ ...fixture, loadToken: token }),
  { mode: 0o600 },
);
// Deliberate allowlist. Never pass the owner credential to a Worker.
await writeFile(
  `${directory}/edge-secrets.json`,
  JSON.stringify({
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: secret,
    LOAD_TOKEN: token,
  }),
  { mode: 0o600 },
);
const base = JSON.parse(await readFile('apps/api/wrangler.jsonc', 'utf8'));
delete base.env;
for (const suffix of ['a', 'b']) {
  await writeFile(
    `${directory}/edge-${suffix}.jsonc`,
    JSON.stringify(
      {
        ...base,
        name: `kwikbus-load-${suffix}`,
        main: resolve('tests/load/edge.ts'),
        workers_dev: true,
        preview_urls: false,
        placement: { region: 'aws:ap-southeast-1' },
        vars: {
          APP_ORIGIN: process.env.APP_ORIGIN,
          DEPLOYMENT_ENV: 'development',
          PAYMENTS_ENABLED: 'false',
        },
      },
      null,
      2,
    ),
  );
}
console.log('Prepared two gated, payment-disabled disposable edge Workers.');
