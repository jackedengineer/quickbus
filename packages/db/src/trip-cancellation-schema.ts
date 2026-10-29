import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { trips } from './booking-schema';
export const tripCancellations = pgTable(
  'trip_cancellations',
  {
    tripId: uuid('trip_id')
      .primaryKey()
      .references(() => trips.id),
    actor: text('actor').notNull(),
    reason: text('reason').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    processedBookings: integer('processed_bookings').notNull().default(0),
  },
  (t) => [
    check(
      'trip_cancellation_actor',
      sql`${t.actor} ~ '^[a-z0-9][a-z0-9:_-]{0,59}$'`,
    ),
    check(
      'trip_cancellation_reason',
      sql`${t.reason} IN ('OPERATOR_CANCELLED','SCHEDULE_CORRECTION','DEMO_RECOVERY')`,
    ),
    check(
      'trip_cancellation_progress',
      sql`${t.processedBookings}>=0 AND (${t.completedAt} IS NULL OR ${t.completedAt}>=${t.requestedAt})`,
    ),
  ],
);
