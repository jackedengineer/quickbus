import { afterEach, expect, test, vi } from 'vitest';
import { runMaintenanceJobs } from '../../packages/backend/src/maintenance';
import type { Database } from '../../packages/db/src/client';

type Query = { queryChunks: unknown[] };
const text = (query: Query) =>
  query.queryChunks
    .map((chunk) =>
      Array.isArray((chunk as { value?: unknown }).value)
        ? (chunk as { value: string[] }).value.join('')
        : '',
    )
    .join('');

// Records which jobs reached their success heartbeat. `failing` names SQL that
// throws, standing in for a job whose work fails partway.
function fakeDatabase(failing: string | null) {
  const succeeded: string[] = [];
  const failed: string[] = [];
  const db = {
    execute: async (query: Query) => {
      const statement = text(query);
      if (failing && statement.includes(failing))
        throw new Error('synthetic failure');
      const name = query.queryChunks.find(
        (c) =>
          typeof c === 'string' &&
          ['expiry', 'inventory', 'payments', 'notifications'].includes(c),
      ) as string | undefined;
      if (name && statement.includes('last_succeeded_at='))
        succeeded.push(name);
      if (name && statement.includes('last_failed_at=')) failed.push(name);
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Database;
  return { db, succeeded, failed };
}

const minuteJobs = ['expiry', 'payments', 'notifications'] as const;
afterEach(() => vi.restoreAllMocks());

test('an expiry failure still runs payments and notifications, then fails the invocation', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const failedLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { db, succeeded, failed } = fakeDatabase('FROM trips t WHERE EXISTS');
  await expect(
    runMaintenanceJobs(db, [...minuteJobs], 'run', {}),
  ).rejects.toThrow('Scheduled maintenance failed.');
  expect(failed).toEqual(['expiry']);
  expect(succeeded).toEqual(['payments', 'notifications']);
  expect(failedLog).toHaveBeenCalledWith(
    expect.stringContaining('"job":"expiry"'),
  );
});

test('a healthy pass runs every job in order and resolves', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const { db, succeeded, failed } = fakeDatabase(null);
  await expect(
    runMaintenanceJobs(db, [...minuteJobs], 'run', {}),
  ).resolves.toBeUndefined();
  expect(succeeded).toEqual([...minuteJobs]);
  expect(failed).toEqual([]);
});
