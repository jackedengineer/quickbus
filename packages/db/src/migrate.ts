import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export async function migrateDatabase(connectionString: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    // Direct connection only: serialize migration runners on a stable advisory key.
    await client.query('SELECT pg_advisory_lock(74910249)');
    await migrate(drizzle(client), {
      migrationsFolder: 'packages/db/migrations',
    });
  } finally {
    await client.end();
  }
}
