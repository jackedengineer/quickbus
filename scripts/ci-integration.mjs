import { spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const directory = 'artifacts/local/ci';
await mkdir(directory, { recursive: true });
const children = [];
const handles = [];
async function start(command, args, name) {
  const handle = await open(`${directory}/${name}.log`, 'w', 0o600);
  handles.push(handle);
  const child = spawn(command, args, {
    env: { ...process.env, KWIKBUS_ENV_FILE: '.env.ci' },
    stdio: ['ignore', handle.fd, handle.fd],
    detached: true,
  });
  children.push(child);
  return child;
}
async function ready(url) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (children.some((c) => c.exitCode !== null))
      throw new Error('A fixture server exited; inspect private CI logs.');
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {}
    await setTimeout(1000);
  }
  throw new Error('Fixture servers did not become ready.');
}
async function run(args, name) {
  const child = await start('node', args, name);
  const code = await new Promise((resolve) => child.once('exit', resolve));
  if (code !== 0)
    throw new Error(`${name} failed; inspect its private fixture log.`);
  console.log(`${name} passed.`);
}
async function stop() {
  for (const child of children)
    if (child.exitCode === null && child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {}
    }
  await Promise.all(handles.map((h) => h.close()));
}
process.once('SIGTERM', () => {
  void stop().finally(() => process.exit(1));
});
process.once('SIGINT', () => {
  void stop().finally(() => process.exit(1));
});
try {
  // Refuse to replace another server or accidentally test a pre-existing app.
  for (const port of [3000, 8787, 8788]) {
    let occupied = false;
    try {
      await fetch(`http://127.0.0.1:${port}`, {
        signal: AbortSignal.timeout(500),
      });
      occupied = true;
    } catch {}
    if (occupied) throw new Error('Required fixture port is already in use.');
  }
  await start('pnpm', ['dev'], 'web-api');
  await ready('http://localhost:8787/api/health/ready');
  await ready('http://localhost:3000/');
  await start('pnpm', ['dev:peer'], 'peer');
  await ready('http://localhost:8788/api/health/ready');
  await run(
    [
      '--env-file=.env.ci',
      'node_modules/vitest/vitest.mjs',
      'run',
      'tests/integration',
      '--no-file-parallelism',
    ],
    'integration',
  );
  await run(
    ['--env-file=.env.ci', '--import', 'tsx', 'scripts/prove-concurrency.ts'],
    'contention',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Isolated CI failed.');
  process.exitCode = 1;
} finally {
  await stop();
}
