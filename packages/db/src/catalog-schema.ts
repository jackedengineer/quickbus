import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';

// Owner-managed definitions. Published trips retain their own immutable labels.
export const cities = pgTable(
  'cities',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    country: text('country').notNull().default('IN'),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
  },
  (t) => [
    check(
      'city_region',
      sql`${t.country}='IN' AND ${t.timezone}='Asia/Kolkata'`,
    ),
  ],
);
export const cityAliases = pgTable(
  'city_aliases',
  {
    alias: text('alias').primaryKey(),
    cityId: text('city_id')
      .notNull()
      .references(() => cities.id),
  },
  (t) => [
    check(
      'city_alias_normalized',
      sql`${t.alias}=lower(btrim(${t.alias})) AND length(${t.alias}) BETWEEN 1 AND 100`,
    ),
  ],
);
export const operators = pgTable('operators', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
});
export const routes = pgTable(
  'routes',
  {
    id: text('id').primaryKey(),
    originCityId: text('origin_city_id')
      .notNull()
      .references(() => cities.id),
    destinationCityId: text('destination_city_id')
      .notNull()
      .references(() => cities.id),
  },
  (t) => [
    unique('route_direction').on(t.originCityId, t.destinationCityId),
    unique('route_identity').on(t.id, t.originCityId, t.destinationCityId),
    check(
      'route_distinct_cities',
      sql`${t.originCityId}<>${t.destinationCityId}`,
    ),
  ],
);
export const layouts = pgTable(
  'layouts',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    vehicleLabel: text('vehicle_label').notNull(),
    seatCount: integer('seat_count').notNull(),
  },
  (t) => [check('layout_capacity', sql`${t.seatCount} BETWEEN 1 AND 80`)],
);
export const layoutSeats = pgTable(
  'layout_seats',
  {
    layoutId: text('layout_id')
      .notNull()
      .references(() => layouts.id),
    label: text('label').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.layoutId, t.label] }),
    unique('layout_seat_position').on(t.layoutId, t.position),
    check(
      'layout_seat_bounds',
      sql`${t.position} BETWEEN 1 AND 80 AND ${t.label} ~ '^[0-9]{1,2}[A-D]$'`,
    ),
  ],
);
export const stops = pgTable(
  'stops',
  {
    id: text('id').primaryKey(),
    cityId: text('city_id')
      .notNull()
      .references(() => cities.id),
    name: text('name').notNull(),
    address: text('address').notNull(),
  },
  (t) => [unique('stop_city_identity').on(t.id, t.cityId)],
);
