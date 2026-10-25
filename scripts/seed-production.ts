import pg from 'pg';
import { seedDemoInventory } from './demo-inventory';

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (
  process.env.DEPLOYMENT_ENV !== 'production' ||
  process.env.CONFIRM_DEMO_INVENTORY !== 'kwikbus_v0' ||
  !connectionString ||
  new URL(connectionString).pathname !== '/kwikbus_v0' ||
  new URL(connectionString).hostname.includes('-pooler')
)
  throw new Error(
    'Explicit production demo inventory confirmation and direct kwikbus_v0 owner URL required.',
  );
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await seedDemoInventory(client, 30);
} finally {
  await client.end();
}
