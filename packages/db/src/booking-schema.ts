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
import { cities, operators, routes, stops } from './catalog-schema';
import { inventoryServices } from './service-schema';

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

// Published snapshots retain their labels when catalog definitions change.
export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey(),
    routeId: text('route_id').references(() => routes.id),
    originCityId: text('origin_city_id').references(() => cities.id),
    destinationCityId: text('destination_city_id').references(() => cities.id),
    operatorId: text('operator_id').references(() => operators.id),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    operatorName: text('operator_name').notNull(),
    sourceServiceId: text('source_service_id').references(
      () => inventoryServices.id,
    ),
    vehicleLabel: text('vehicle_label').notNull().default('AC Seater (2+2)'),
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
    foreignKey({
      columns: [t.routeId, t.originCityId, t.destinationCityId],
      foreignColumns: [
        routes.id,
        routes.originCityId,
        routes.destinationCityId,
      ],
    }),
    check(
      'trip_catalog_pair',
      sql`(${t.routeId} IS NULL AND ${t.originCityId} IS NULL AND ${t.destinationCityId} IS NULL) OR (${t.routeId} IS NOT NULL AND ${t.originCityId} IS NOT NULL AND ${t.destinationCityId} IS NOT NULL)`,
    ),
    index('trip_departure').on(t.departureAt),
    index('trip_route_departure').on(
      t.originCityId,
      t.destinationCityId,
      t.departureAt,
      t.id,
    ),
    unique('trip_service_departure').on(t.sourceServiceId, t.departureAt),
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
    version: integer('version').notNull().default(1),
    pickupStopId: uuid('pickup_stop_id'),
    dropStopId: uuid('drop_stop_id'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    totalMinor: integer('total_minor').notNull(),
    currency: text('currency').notNull().default('INR'),
    expiresAt: instant('expires_at').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('booking_id_trip').on(t.id, t.tripId),
    foreignKey({
      columns: [t.tripId, t.pickupStopId],
      foreignColumns: [tripStops.tripId, tripStops.id],
    }),
    foreignKey({
      columns: [t.tripId, t.dropStopId],
      foreignColumns: [tripStops.tripId, tripStops.id],
    }),
    check(
      'booking_details_bounds',
      sql`${t.version}>0 AND ((${t.pickupStopId} IS NULL AND ${t.dropStopId} IS NULL) OR (${t.pickupStopId} IS NOT NULL AND ${t.dropStopId} IS NOT NULL AND ${t.pickupStopId}<>${t.dropStopId})) AND (${t.contactEmail} IS NULL OR length(${t.contactEmail}) BETWEEN 3 AND 254) AND (${t.contactPhone} IS NULL OR ${t.contactPhone} ~ '^[+][1-9][0-9]{6,14}$')`,
    ),
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
    passengerName: text('passenger_name'),
  },
  (t) => [
    check(
      'passenger_name_bounds',
      sql`${t.passengerName} IS NULL OR (length(${t.passengerName}) BETWEEN 2 AND 100 AND ${t.passengerName}=btrim(${t.passengerName}) AND ${t.passengerName} !~ '[[:cntrl:]]')`,
    ),
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
    version: integer('version').notNull().default(0),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [unique('booking_event_version').on(t.bookingId, t.type, t.version)],
);

export const tripStops = pgTable(
  'trip_stops',
  {
    id: uuid('id').primaryKey(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id),
    sourceStopId: text('source_stop_id')
      .notNull()
      .references(() => stops.id),
    cityId: text('city_id')
      .notNull()
      .references(() => cities.id),
    name: text('name').notNull(),
    address: text('address').notNull(),
    role: text('role').notNull(),
    sequence: integer('sequence').notNull(),
    scheduledAt: instant('scheduled_at').notNull(),
  },
  (t) => [
    unique('trip_stop_identity').on(t.tripId, t.id),
    foreignKey({
      columns: [t.sourceStopId, t.cityId],
      foreignColumns: [stops.id, stops.cityId],
    }),
    unique('trip_stop_sequence').on(t.tripId, t.sequence),
    check(
      'trip_stop_bounds',
      sql`${t.role} IN ('PICKUP','DROP') AND ${t.sequence} BETWEEN 1 AND 20`,
    ),
  ],
);
