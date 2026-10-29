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
import { bookings } from './booking-schema';

const instant = (name: string) => timestamp(name, { withTimezone: true });
// One durable delivery per lifecycle event. Recipient/body stay in the owned
// booking snapshot; only their digest is stored here to fence changed retries.
export const bookingNotifications = pgTable(
  'booking_notifications',
  {
    id: uuid('id').primaryKey(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    kind: text('kind').notNull(),
    state: text('state').notNull().default('QUEUED'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: instant('available_at').notNull().defaultNow(),
    firstAttemptAt: instant('first_attempt_at'),
    requestHash: text('request_hash'),
    providerId: text('provider_id'),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: instant('lease_expires_at'),
    failureCode: text('failure_code'),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('notification_booking_kind').on(t.bookingId, t.kind),
    index('notification_due')
      .on(t.availableAt)
      .where(sql`${t.state} IN ('QUEUED','RUNNING')`),
    check('notification_kind', sql`${t.kind} IN ('CONFIRMED','CANCELLED')`),
    check(
      'notification_state',
      sql`${t.state} IN ('QUEUED','RUNNING','SENT','NEEDS_REVIEW','SKIPPED')`,
    ),
    check('notification_attempts', sql`${t.attempts} BETWEEN 0 AND 16`),
    check(
      'notification_lease',
      sql`(${t.state}='RUNNING' AND ${t.leaseToken} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL) OR (${t.state}<>'RUNNING' AND ${t.leaseToken} IS NULL AND ${t.leaseExpiresAt} IS NULL)`,
    ),
    check(
      'notification_request_identity',
      sql`(${t.firstAttemptAt} IS NULL AND ${t.requestHash} IS NULL) OR (${t.firstAttemptAt} IS NOT NULL AND ${t.requestHash} IS NOT NULL AND ${t.requestHash} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      'notification_sent_identity',
      sql`${t.state}<>'SENT' OR ${t.providerId} IS NOT NULL`,
    ),
    check(
      'notification_failure',
      sql`${t.failureCode} IS NULL OR ${t.failureCode} IN ('DELIVERY_UNCERTAIN','RETRY_EXHAUSTED','CONFIGURATION_CHANGED','LEGACY_NOT_SCHEDULED','DELIVERY_REJECTED')`,
    ),
  ],
);
