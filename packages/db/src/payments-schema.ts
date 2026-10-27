import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bookings } from './booking-schema';

const instant = (name: string) => timestamp(name, { withTimezone: true });
export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: uuid('id').primaryKey(),
    bookingId: uuid('booking_id')
      .notNull()
      .unique()
      .references(() => bookings.id),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull().default('INR'),
    keyId: text('key_id').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'payment_intent_money',
      sql`${t.amount} BETWEEN 100 AND 10000000 AND ${t.currency}='INR'`,
    ),
    check(
      'payment_intent_test_key',
      sql`${t.keyId} ~ '^rzp_test_[A-Za-z0-9]+$'`,
    ),
  ],
);

export const checkoutAttempts = pgTable(
  'checkout_attempts',
  {
    id: uuid('id').primaryKey(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    number: integer('number').notNull(),
    state: text('state').notNull().default('PENDING'),
    orderId: text('order_id').unique(),
    createdAt: instant('created_at').notNull().defaultNow(),
    startedAt: instant('started_at'),
    lastCheckedAt: instant('last_checked_at'),
  },
  (t) => [
    unique('checkout_sequence').on(t.intentId, t.number),
    unique('checkout_intent_identity').on(t.id, t.intentId),
    uniqueIndex('one_unresolved_checkout')
      .on(t.intentId)
      .where(sql`${t.state} IN ('PENDING','CREATING','UNKNOWN','READY')`),
    index('checkout_order_reconcile').on(t.lastCheckedAt),
    check('checkout_number', sql`${t.number} BETWEEN 1 AND 10`),
    check(
      'checkout_state',
      sql`${t.state} IN ('PENDING','CREATING','UNKNOWN','READY','FAILED','CAPTURED','CLOSED')`,
    ),
    check(
      'checkout_provider_order',
      sql`${t.orderId} IS NULL OR ${t.orderId} ~ '^order_[A-Za-z0-9]{1,40}$'`,
    ),
    check(
      'checkout_ready_order',
      sql`${t.state} NOT IN ('READY','CAPTURED') OR ${t.orderId} IS NOT NULL`,
    ),
  ],
);

export const providerPayments = pgTable(
  'provider_payments',
  {
    id: text('id').primaryKey(),
    checkoutId: uuid('checkout_id').notNull(),
    intentId: uuid('intent_id').notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    state: text('state').notNull(),
    disposition: text('disposition').notNull().default('PENDING'),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.checkoutId, t.intentId],
      foreignColumns: [checkoutAttempts.id, checkoutAttempts.intentId],
    }),
    uniqueIndex('one_fulfillment_per_intent')
      .on(t.intentId)
      .where(sql`${t.disposition}='FULFILLED'`),
    check('provider_payment_id', sql`${t.id} ~ '^pay_[A-Za-z0-9]{1,40}$'`),
    check(
      'provider_payment_money',
      sql`${t.amount} BETWEEN 0 AND 10000000 AND length(${t.currency})=3`,
    ),
    check(
      'provider_payment_state',
      sql`${t.state} IN ('created','authorized','failed','captured','refunded')`,
    ),
    check(
      'provider_payment_disposition',
      sql`${t.disposition} IN ('PENDING','FULFILLED','REFUND','REVIEW')`,
    ),
    check(
      'payment_fulfillment_captured',
      sql`${t.disposition}<>'FULFILLED' OR ${t.state} IN ('captured','refunded')`,
    ),
  ],
);

export const paymentRefunds = pgTable(
  'payment_refunds',
  {
    id: uuid('id').primaryKey(),
    paymentId: text('payment_id')
      .notNull()
      .unique()
      .references(() => providerPayments.id),
    amount: integer('amount').notNull(),
    state: text('state').notNull().default('PENDING'),
    providerId: text('provider_id').unique(),
    startedAt: instant('started_at'),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('refund_money', sql`${t.amount} BETWEEN 100 AND 10000000`),
    check(
      'refund_state',
      sql`${t.state} IN ('PENDING','PROCESSING','UNKNOWN','PROCESSED','NEEDS_REVIEW')`,
    ),
    check(
      'refund_provider_id',
      sql`${t.providerId} IS NULL OR ${t.providerId} ~ '^rfnd_[A-Za-z0-9]{1,40}$'`,
    ),
  ],
);

export const paymentInbox = pgTable(
  'payment_inbox',
  {
    id: uuid('id').primaryKey(),
    eventId: text('event_id').notNull().unique(),
    eventType: text('event_type').notNull(),
    payloadHash: text('payload_hash').notNull(),
    orderId: text('order_id'),
    paymentId: text('payment_id'),
    refundId: text('refund_id'),
    receivedAt: instant('received_at').notNull().defaultNow(),
    processedAt: instant('processed_at'),
  },
  (t) => [
    check(
      'inbox_event_bounds',
      sql`length(${t.eventId}) BETWEEN 1 AND 100 AND length(${t.eventType}) BETWEEN 1 AND 80 AND ${t.payloadHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

// Bounded reason and opaque IDs only; no raw API bodies or personal data.
export const paymentCases = pgTable(
  'payment_cases',
  {
    id: uuid('id').primaryKey(),
    caseKey: text('case_key').notNull().unique(),
    reason: text('reason').notNull(),
    checkoutId: uuid('checkout_id').references(() => checkoutAttempts.id),
    state: text('state').notNull().default('OPEN'),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'payment_case_bounds',
      sql`length(${t.caseKey}) BETWEEN 1 AND 180 AND ${t.reason} IN ('ORDER_AMBIGUOUS','MONEY_MISMATCH','UNMAPPED_EVENT','EVENT_HASH_MISMATCH','REFUND_UNCERTAIN','REFUND_FAILED','RETRY_EXHAUSTED','ALLOCATION_MISMATCH') AND ${t.state} IN ('OPEN','RESOLVED')`,
    ),
  ],
);
