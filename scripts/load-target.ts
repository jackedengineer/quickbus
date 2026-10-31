import pg from 'pg';

// No arbitrary load target: either the pinned local fixture, or an explicitly
// selected disposable Neon database. Production names cannot pass this guard.
export function loadTarget() {
  const owner = new URL(process.env.MIGRATION_DATABASE_URL ?? '');
  const runtime = new URL(process.env.DATABASE_URL ?? '');
  const neon = process.argv.includes('--neon');
  const allowed = neon
    ? owner.hostname.endsWith('.neon.tech') &&
      !owner.hostname.includes('-pooler.') &&
      /^\/kwikbus_load_\d{8}$/.test(owner.pathname) &&
      runtime.pathname === owner.pathname &&
      runtime.hostname.replace('-pooler.', '.') === owner.hostname &&
      runtime.username === 'quickbus_runtime' &&
      runtime.searchParams.get('sslmode') === 'verify-full' &&
      !process.env.CI_DATABASE_PROXY
    : owner.hostname === '127.0.0.1' &&
      owner.port === '55432' &&
      owner.pathname === '/quickbus_ci' &&
      process.env.CI_DATABASE_PROXY === '127.0.0.1:6543';
  if (
    !allowed ||
    process.env.DEPLOYMENT_ENV !== 'local' ||
    process.env.ALLOW_DEV_FIXTURES !== 'true' ||
    process.env.APP_ORIGIN !== 'http://localhost:3002'
  )
    throw Error('Use an explicitly isolated load fixture configuration.');
  return {
    client: new pg.Client({
      connectionString: owner.href,
      connectionTimeoutMillis: 10000,
      query_timeout: 180000,
    }),
    directory: `artifacts/local/${neon ? 'load-neon' : 'load'}`,
    endpoint: `http://localhost:${neon ? 8791 : 8787}`,
  };
}
