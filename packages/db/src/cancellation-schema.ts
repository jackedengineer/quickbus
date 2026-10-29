import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { bookings } from './booking-schema';

// Append-only accepted cancellation. Refund execution keeps its existing identity.
export const bookingCancellations = pgTable(
  'booking_cancellations',
  {
    bookingId: uuid('booking_id')
      .primaryKey()
      .references(() => bookings.id),
    source: text('source').notNull(),
    actor: text('actor').notNull(),
    policyVersion: integer('policy_version').notNull().default(1),
    refundMinor: integer('refund_minor').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check('cancellation_source', sql`${t.source} IN ('CUSTOMER','TRIP')`),
    check('cancellation_actor', sql`length(${t.actor}) BETWEEN 1 AND 100`),
    check('cancellation_policy', sql`${t.policyVersion}=1`),
    check(
      'cancellation_refund_bounds',
      sql`${t.refundMinor} BETWEEN 0 AND 10000000`,
    ),
  ],
);
