import { validateEnvironment } from '../apps/api/src/environment';
import type { AppEnvironment } from '../packages/backend/src/context';
import { runMaintenance } from '../packages/backend/src/maintenance';
import { createDatabase } from '../packages/db/src/client';

if (
  process.env.CONFIRM_MAINTENANCE !== 'kwikbus_v0' ||
  process.env.DEPLOYMENT_ENV !== 'production'
)
  throw new Error('Explicit production maintenance confirmation required.');
const environment: AppEnvironment = {
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  AUTH_SECRET: process.env.AUTH_SECRET ?? '',
  APP_ORIGIN: process.env.APP_ORIGIN ?? '',
  DEPLOYMENT_ENV: 'production',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  PAYMENTS_ENABLED: process.env.PAYMENTS_ENABLED,
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
};
validateEnvironment(environment);
const database = createDatabase(environment.DATABASE_URL);
try {
  await runMaintenance(database.db, 'expiry');
  await runMaintenance(database.db, 'inventory');
  await runMaintenance(database.db, 'payments', undefined, environment);
} finally {
  await database.close();
}
