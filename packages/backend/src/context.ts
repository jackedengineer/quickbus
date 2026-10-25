import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database } from '@kwikbus/db';
import type { AuthEnvironment } from './auth';

export type AppEnvironment = AuthEnvironment & { DATABASE_URL: string };
export const requestContext = new AsyncLocalStorage<{
  db: Database;
  environment: AppEnvironment;
}>();

export function context() {
  const value = requestContext.getStore();
  if (!value) throw new Error('Request context is unavailable.');
  return value;
}
