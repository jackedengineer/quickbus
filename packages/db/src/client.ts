import { Client, Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

// Edge pools must live within one invocation, never at module scope.
// https://neon.com/docs/serverless/serverless-driver#pool-and-client-usage-notes
export function createDatabase(connectionString: string, ciProxy?: string) {
  let Driver = Client;
  if (ciProxy) {
    const target = new URL(connectionString);
    if (
      ciProxy !== '127.0.0.1:6543' ||
      target.hostname !== '127.0.0.1' ||
      target.port !== '55432' ||
      target.pathname !== '/quickbus_ci' ||
      target.searchParams.get('sslmode') !== 'disable'
    )
      throw new Error(
        'The CI proxy is restricted to the isolated loopback fixture database.',
      );
    Driver = class extends Client {
      constructor(config?: ConstructorParameters<typeof Client>[0]) {
        super(config);
        this.neonConfig.wsProxy = () => `${ciProxy}/v1?address=postgres:5432`;
        this.neonConfig.useSecureWebSocket = false;
        this.neonConfig.pipelineConnect = false;
      }
    };
  }
  const pool = new Pool({
    connectionString,
    Client: Driver,
    max: 1,
    connectionTimeoutMillis: 8000,
  });
  // The Neon Pool overrides pg's Client constructor during initialisation.
  // Set its documented public Client property before the first connection.
  pool.Client = Driver;
  // Idle sockets can fail independently of an awaited query. The pool removes
  // the failed client; query errors still reject and roll back normally.
  pool.on('error', () => {
    console.error(JSON.stringify({ event: 'database_idle_connection_error' }));
  });
  return { db: drizzle({ client: pool, schema }), close: () => pool.end() };
}

export type Database = ReturnType<typeof createDatabase>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
