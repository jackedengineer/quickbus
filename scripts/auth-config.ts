import { createAuth } from '../packages/backend/src/auth';
import { createDatabase } from '../packages/db/src/client';

const database = createDatabase(
  process.env.DATABASE_URL ?? 'postgresql://unused:unused@localhost/unused',
);
export const auth = createAuth(database.db, {
  AUTH_SECRET:
    process.env.AUTH_SECRET ?? 'schema-generation-only-not-a-runtime-secret',
  APP_ORIGIN: 'http://localhost:3000',
  DEPLOYMENT_ENV: 'local',
});
