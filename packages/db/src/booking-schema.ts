import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema';

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

// Published snapshots. Editable city/operator/template catalogs arrive in the next slice.
export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey(),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    operatorName: text('operator_name').notNull(),
    departureAt: instant('departure_at').notNull(),
    arrivalAt: instant('arrival_at').notNull(),
    salesCloseAt: instant('sales_close_at').notNull(),
    salesState: text('sales_state').notNull().default('OPEN'),
  },
  (t) => [
    check(
      'trip_time_order',
      sql`${t.arrivalAt} > ${t.departureAt} AND ${t.salesCloseAt} < ${t.departureAt}`,
    ),
    check(
      'trip_sales_state',
      sql`${t.salesState} IN ('OPEN', 'CLOSED', 'CANCELLED')`,
    ),
    index('trip_departure').on(t.departureAt),
  ],
);

export const tripSeats = pgTable(
  'trip_seats',
  {
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id),
    seatLabel: text('seat_label').notNull(),
    position: integer('position').notNull(),
    fareMinor: integer('fare_minor').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tripId, t.seatLabel] }),
    unique('trip_seat_position').on(t.tripId, t.position),
    check(
      'seat_fare_bounds',
      sql`${t.fareMinor} > 0 AND ${t.fareMinor} <= 2500000`,
    ),
  ],
);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    reference: text('reference').notNull().unique(),
    status: text('status').notNull().default('HELD'),
    totalMinor: integer('total_minor').notNull(),
    currency: text('currency').notNull().default('INR'),
    expiresAt: instant('expires_at').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('booking_id_trip').on(t.id, t.tripId),
    uniqueIndex('one_pending_booking_per_customer_trip')
      .on(t.tripId, t.userId)
      .where(sql`${t.status} = 'HELD'`),
    index('booking_due_expiry')
      .on(t.tripId, t.expiresAt)
      .where(sql`${t.status} = 'HELD'`),
    check(
      'booking_unpaid_state',
      sql`${t.status} IN ('HELD', 'EXPIRED', 'CANCELLED')`,
    ),
    check(
      'booking_money',
      sql`${t.totalMinor} > 0 AND ${t.totalMinor} <= 10000000 AND ${t.currency} = 'INR'`,
    ),
  ],
);

export const bookingItems = pgTable(
  'booking_items',
  {
    bookingId: uuid('booking_id').notNull(),
    tripId: uuid('trip_id').notNull(),
    seatLabel: text('seat_label').notNull(),
    fareMinor: integer('fare_minor').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.bookingId, t.seatLabel] }),
    unique('booking_item_identity').on(t.bookingId, t.tripId, t.seatLabel),
    foreignKey({
      columns: [t.bookingId, t.tripId],
      foreignColumns: [bookings.id, bookings.tripId],
    }),
    foreignKey({
      columns: [t.tripId, t.seatLabel],
      foreignColumns: [tripSeats.tripId, tripSeats.seatLabel],
    }),
    check(
      'item_fare_bounds',
      sql`${t.fareMinor} > 0 AND ${t.fareMinor} <= 2500000`,
    ),
  ],
);

export const seatAllocations = pgTable(
  'seat_allocations',
  {
    tripId: uuid('trip_id').notNull(),
    seatLabel: text('seat_label').notNull(),
    bookingId: uuid('booking_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tripId, t.seatLabel] }),
    foreignKey({
      columns: [t.bookingId, t.tripId, t.seatLabel],
      foreignColumns: [
        bookingItems.bookingId,
        bookingItems.tripId,
        bookingItems.seatLabel,
      ],
    }),
    index('allocation_booking').on(t.bookingId),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    principalId: text('principal_id')
      .notNull()
      .references(() => user.id),
    scope: text('scope').notNull(),
    key: uuid('key').notNull(),
    requestHash: text('request_hash').notNull(),
    httpStatus: integer('http_status'),
    response: jsonb('response'),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.principalId, t.scope, t.key] })],
);

export const bookingEvents = pgTable(
  'booking_events',
  {
    id: uuid('id').primaryKey(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    type: text('type').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [unique('booking_event_type').on(t.bookingId, t.type)],
);
