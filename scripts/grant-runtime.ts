import pg from 'pg';

const ownerUrl = process.env.MIGRATION_DATABASE_URL;
const runtimeUrl = process.env.DATABASE_URL;
if (!ownerUrl || !runtimeUrl)
  throw new Error('Direct owner and runtime URLs required.');
const owner = new URL(ownerUrl),
  runtime = new URL(runtimeUrl);
const role = decodeURIComponent(runtime.username);
if (
  owner.hostname.includes('-pooler') ||
  owner.pathname !== runtime.pathname ||
  !['quickbus_runtime', 'kwikbus_v0_runtime'].includes(role) ||
  (role === 'kwikbus_v0_runtime' &&
    (process.env.DEPLOYMENT_ENV !== 'production' ||
      owner.pathname !== '/kwikbus_v0'))
)
  throw new Error(
    'Grant target must match the reviewed application database and role.',
  );
const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
try {
  // Identifiers come only from the fixed allowlist above, never user input.
  await client.query(
    `GRANT SELECT,INSERT,UPDATE ON maintenance_jobs TO "${role}"`,
  );
  await client.query(
    `GRANT SELECT ON inventory_services,inventory_service_seats TO "${role}"`,
  );
  await client.query(`GRANT INSERT ON trips,trip_seats TO "${role}"`);
  console.log('Reviewed maintenance and snapshot-publication grants applied.');
} finally {
  await client.end();
}
