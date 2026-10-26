import { expect, test, vi } from 'vitest';
import { createDatabase } from '../../packages/db/src/client';
import { sql } from '../../packages/db/src/schema';
import { fixtureClient } from '../support/fixtures';

test('an idle connection terminated by Postgres is reported safely and the pool replaces it', async () => {
  const owner = await fixtureClient();
  // Direct endpoint gives this test an exclusive backend session, so terminating
  // its PID cannot interrupt another request behind the transaction pooler.
  const direct = new URL(process.env.MIGRATION_DATABASE_URL ?? '');
  const runtime = new URL(process.env.DATABASE_URL ?? '');
  direct.username = runtime.username;
  direct.password = runtime.password;
  const database = createDatabase(
    direct.toString(),
    process.env.CI_DATABASE_PROXY,
  );
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const before = await database.db.execute<{ pid: number }>(
      sql`SELECT pg_backend_pid() AS pid`,
    );
    const terminated = await owner.query(
      'SELECT pg_terminate_backend($1) AS terminated',
      [before.rows[0].pid],
    );
    expect(terminated.rows[0].terminated).toBe(true);
    await vi.waitFor(
      () =>
        expect(
          errors.mock.calls.some(
            (call) =>
              typeof call[0] === 'string' &&
              JSON.parse(call[0]).event === 'database_idle_connection_error' &&
              /^[0-9a-f-]{36}$/i.test(JSON.parse(call[0]).requestId),
          ),
        ).toBe(true),
      { timeout: 5000 },
    );
    const after = await database.db.execute<{ pid: number; value: number }>(
      sql`SELECT pg_backend_pid() AS pid,1 AS value`,
    );
    expect(after.rows[0].value).toBe(1);
    expect(after.rows[0].pid).not.toBe(before.rows[0].pid);
  } finally {
    errors.mockRestore();
    await database.close();
    await owner.end();
  }
});
