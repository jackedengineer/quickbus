import { migrateDatabase } from '../packages/db/src/migrate';

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (
  !connectionString ||
  new URL(connectionString).hostname.includes('-pooler')
) {
  throw new Error('Migrations require the direct MIGRATION_DATABASE_URL.');
}
await migrateDatabase(connectionString);
console.log('Reviewed migrations applied successfully.');
