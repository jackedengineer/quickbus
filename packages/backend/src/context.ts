import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database } from '@kwikbus/db';
import type { AuthEnvironment } from './auth';
import type { RazorpayEnvironment } from './razorpay';

export type AppEnvironment = AuthEnvironment &
  RazorpayEnvironment & {
    DATABASE_URL: string;
    CI_DATABASE_PROXY?: string;
    // Bearer token for /api/health/ready and /maintenance. Required in production.
    HEALTH_TOKEN?: string;
  };
export const requestContext = new AsyncLocalStorage<{
  db: Database;
  environment: AppEnvironment;
}>();

export function context() {
  const value = requestContext.getStore();
  if (!value) throw new Error('Request context is unavailable.');
  return value;
}
