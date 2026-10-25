import { expect, test } from 'vitest';
import { createDatabase } from '../../packages/db/src/client';
import { sql } from '../../packages/db/src/schema';

test('interactive Neon transactions retain their session and roll back failed work', async () => {
  const database = createDatabase(process.env.DATABASE_URL ?? '');
  try {
    await expect(
      database.db.transaction(async (tx) => {
        const first = await tx.execute(sql`select pg_backend_pid() as pid`);
        await tx.execute(
          sql`create temporary table quickbus_rollback_probe (value integer) on commit drop`,
        );
        await tx.execute(sql`insert into quickbus_rollback_probe values (7)`);
        const second = await tx.execute(
          sql`select pg_backend_pid() as pid, value from quickbus_rollback_probe`,
        );
        expect(second.rows[0]).toMatchObject({
          pid: first.rows[0]?.pid,
          value: 7,
        });
        throw new Error('intentional rollback');
      }),
    ).rejects.toThrow('intentional rollback');
    const result = await database.db.execute(
      sql`select to_regclass('pg_temp.quickbus_rollback_probe') as probe`,
    );
    expect(result.rows[0]?.probe).toBeNull();
  } finally {
    await database.close();
  }
});

test('the pooled application role has no database, role, or public-schema creation privilege', async () => {
  const database = createDatabase(process.env.DATABASE_URL ?? '');
  try {
    const result = await database.db.execute<{
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      schema_create: boolean;
    }>(
      sql`SELECT rolsuper,rolcreatedb,rolcreaterole,has_schema_privilege(current_user,'public','CREATE') AS schema_create FROM pg_roles WHERE rolname=current_user`,
    );
    expect(result.rows[0]).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      schema_create: false,
    });
  } finally {
    await database.close();
  }
});
