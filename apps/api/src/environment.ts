import type { AppEnvironment } from '@kwikbus/backend/context';

export function validateEnvironment(environment: AppEnvironment) {
  if (
    environment.PAYMENTS_ENABLED === 'true' &&
    (!/^rzp_test_[A-Za-z0-9]+$/.test(environment.RAZORPAY_KEY_ID ?? '') ||
      !environment.RAZORPAY_KEY_SECRET ||
      !environment.RAZORPAY_WEBHOOK_SECRET)
  )
    throw new Error('Test payment configuration required.');
  if (!environment.AUTH_SECRET || environment.AUTH_SECRET.length < 32)
    throw new Error('Invalid authentication configuration.');
  const origin = new URL(environment.APP_ORIGIN);
  if (origin.origin !== environment.APP_ORIGIN)
    throw new Error('APP_ORIGIN must be an exact origin.');
  const database = new URL(environment.DATABASE_URL);
  if (environment.DEPLOYMENT_ENV === 'production') {
    if (
      origin.protocol !== 'https:' ||
      !['kwikbus.ichiragbhugra.workers.dev', 'kwikbus.jacked.dev'].includes(
        origin.hostname,
      ) ||
      database.pathname !== '/kwikbus_v0' ||
      database.username !== 'kwikbus_v0_runtime' ||
      database.searchParams.get('sslmode') !== 'verify-full' ||
      environment.MAILPIT_URL ||
      environment.CI_DATABASE_PROXY ||
      !environment.GOOGLE_CLIENT_ID ||
      !environment.GOOGLE_CLIENT_SECRET
    )
      throw new Error('Invalid production configuration.');
  }
}
