import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  time,
  unique,
} from 'drizzle-orm/pg-core';

// Synthetic service definitions are persistent data. Runtime renewal never owns
// or edits these definitions; it only publishes immutable trip/seat snapshots.
export const inventoryServices = pgTable(
  'inventory_services',
  {
    id: text('id').primaryKey(),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    operatorName: text('operator_name').notNull(),
    vehicleLabel: text('vehicle_label').notNull(),
    departureLocalTime: time('departure_local_time').notNull(),
    travelMinutes: integer('travel_minutes').notNull(),
    salesLeadMinutes: integer('sales_lead_minutes').notNull(),
    seatCount: integer('seat_count').notNull(),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    check(
      'service_cities',
      sql`length(${t.origin}) BETWEEN 1 AND 100 AND length(${t.destination}) BETWEEN 1 AND 100 AND ${t.origin}<>${t.destination}`,
    ),
    check(
      'service_bounds',
      sql`${t.travelMinutes} BETWEEN 1 AND 4320 AND ${t.salesLeadMinutes} BETWEEN 2 AND 1440 AND ${t.seatCount} BETWEEN 1 AND 80`,
    ),
  ],
);
export const inventoryServiceSeats = pgTable(
  'inventory_service_seats',
  {
    serviceId: text('service_id')
      .notNull()
      .references(() => inventoryServices.id),
    label: text('label').notNull(),
    position: integer('position').notNull(),
    fareMinor: integer('fare_minor').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.serviceId, t.label] }),
    unique('service_seat_position').on(t.serviceId, t.position),
    check(
      'service_seat_bounds',
      sql`${t.position} BETWEEN 1 AND 80 AND ${t.fareMinor} BETWEEN 1 AND 2500000 AND ${t.label} ~ '^[0-9]{1,2}[A-D]$'`,
    ),
  ],
);
