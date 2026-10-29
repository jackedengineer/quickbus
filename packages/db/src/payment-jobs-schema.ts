import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// Transactional outbox and work queue in one table. Only local resource IDs;
// business records retain immutable amounts and provider identities.
export const paymentJobs = pgTable(
  'payment_jobs',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull(),
    resourceId: uuid('resource_id').notNull(),
    state: text('state').notNull().default('QUEUED'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    failureCode: text('failure_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('payment_job_resource').on(t.kind, t.resourceId),
    index('payment_job_due')
      .on(t.availableAt)
      .where(sql`${t.state} IN ('QUEUED','RUNNING')`),
    check(
      'payment_job_kind',
      sql`${t.kind} IN ('ORDER','RECONCILE','REFUND','INBOX','TRIP_CANCEL')`,
    ),
    check(
      'payment_job_state',
      sql`${t.state} IN ('QUEUED','RUNNING','DONE','FAILED')`,
    ),
    check('payment_job_attempt_bounds', sql`${t.attempts} BETWEEN 0 AND 32`),
    check(
      'payment_job_lease',
      sql`(${t.state}='RUNNING' AND ${t.leaseToken} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL)
        OR (${t.state}<>'RUNNING' AND ${t.leaseToken} IS NULL AND ${t.leaseExpiresAt} IS NULL)`,
    ),
    check(
      'payment_job_failure_code',
      sql`${t.failureCode} IS NULL OR ${t.failureCode} IN ('PROVIDER_UNAVAILABLE','PROCESSING_FAILED','RETRY_EXHAUSTED')`,
    ),
  ],
);
