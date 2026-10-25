import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

// Edge pools must live within one invocation, never at module scope.
// https://neon.com/docs/serverless/serverless-driver#pool-and-client-usage-notes
export function createDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 8000,
  });
  // Idle sockets can fail independently of an awaited query. The pool removes
  // the failed client; query errors still reject and roll back normally.
  pool.on('error', () => {
    console.error(JSON.stringify({ event: 'database_idle_connection_error' }));
  });
  return { db: drizzle({ client: pool, schema }), close: () => pool.end() };
}

export type Database = ReturnType<typeof createDatabase>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
