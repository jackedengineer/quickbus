import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const environment = await readFile('.env', 'utf8');
await writeFile('apps/api/.dev.vars', environment, { mode: 0o600 });
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
  spawn('pnpm', ['--filter', '@quickbus/web', 'dev'], { stdio: 'inherit' }),
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
