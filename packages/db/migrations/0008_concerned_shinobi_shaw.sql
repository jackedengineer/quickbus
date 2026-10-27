CREATE TABLE "checkout_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"intent_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"order_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	CONSTRAINT "checkout_attempts_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "checkout_sequence" UNIQUE("intent_id","number"),
	CONSTRAINT "checkout_intent_identity" UNIQUE("id","intent_id"),
	CONSTRAINT "checkout_number" CHECK ("checkout_attempts"."number" BETWEEN 1 AND 10),
	CONSTRAINT "checkout_state" CHECK ("checkout_attempts"."state" IN ('PENDING','CREATING','UNKNOWN','READY','FAILED','CAPTURED','CLOSED')),
	CONSTRAINT "checkout_provider_order" CHECK ("checkout_attempts"."order_id" IS NULL OR "checkout_attempts"."order_id" ~ '^order_[A-Za-z0-9]{1,40}$'),
	CONSTRAINT "checkout_ready_order" CHECK ("checkout_attempts"."state" NOT IN ('READY','CAPTURED') OR "checkout_attempts"."order_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "payment_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_key" text NOT NULL,
	"reason" text NOT NULL,
	"checkout_id" uuid,
	"state" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_cases_case_key_unique" UNIQUE("case_key"),
	CONSTRAINT "payment_case_bounds" CHECK (length("payment_cases"."case_key") BETWEEN 1 AND 180 AND "payment_cases"."reason" IN ('ORDER_AMBIGUOUS','MONEY_MISMATCH','UNMAPPED_EVENT','EVENT_HASH_MISMATCH','REFUND_UNCERTAIN','REFUND_FAILED','RETRY_EXHAUSTED','ALLOCATION_MISMATCH') AND "payment_cases"."state" IN ('OPEN','RESOLVED'))
);
--> statement-breakpoint
CREATE TABLE "payment_inbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"order_id" text,
	"payment_id" text,
	"refund_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "payment_inbox_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "inbox_event_bounds" CHECK (length("payment_inbox"."event_id") BETWEEN 1 AND 100 AND length("payment_inbox"."event_type") BETWEEN 1 AND 80 AND "payment_inbox"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"key_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_intents_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "payment_intent_money" CHECK ("payment_intents"."amount" BETWEEN 100 AND 10000000 AND "payment_intents"."currency"='INR'),
	CONSTRAINT "payment_intent_test_key" CHECK ("payment_intents"."key_id" ~ '^rzp_test_[A-Za-z0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"amount" integer NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"provider_id" text,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_refunds_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "payment_refunds_provider_id_unique" UNIQUE("provider_id"),
	CONSTRAINT "refund_money" CHECK ("payment_refunds"."amount" BETWEEN 100 AND 10000000),
	CONSTRAINT "refund_state" CHECK ("payment_refunds"."state" IN ('PENDING','PROCESSING','UNKNOWN','PROCESSED','NEEDS_REVIEW')),
	CONSTRAINT "refund_provider_id" CHECK ("payment_refunds"."provider_id" IS NULL OR "payment_refunds"."provider_id" ~ '^rfnd_[A-Za-z0-9]{1,40}$')
);
--> statement-breakpoint
CREATE TABLE "provider_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"checkout_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"state" text NOT NULL,
	"disposition" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_payment_id" CHECK ("provider_payments"."id" ~ '^pay_[A-Za-z0-9]{1,40}$'),
	CONSTRAINT "provider_payment_money" CHECK ("provider_payments"."amount" BETWEEN 0 AND 10000000 AND length("provider_payments"."currency")=3),
	CONSTRAINT "provider_payment_state" CHECK ("provider_payments"."state" IN ('created','authorized','failed','captured','refunded')),
	CONSTRAINT "provider_payment_disposition" CHECK ("provider_payments"."disposition" IN ('PENDING','FULFILLED','REFUND','REVIEW')),
	CONSTRAINT "payment_fulfillment_captured" CHECK ("provider_payments"."disposition"<>'FULFILLED' OR "provider_payments"."state" IN ('captured','refunded'))
);
--> statement-breakpoint
ALTER TABLE "checkout_attempts" ADD CONSTRAINT "checkout_attempts_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_cases" ADD CONSTRAINT "payment_cases_checkout_id_checkout_attempts_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "public"."checkout_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_payment_id_provider_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."provider_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_payments" ADD CONSTRAINT "provider_payments_checkout_id_intent_id_checkout_attempts_id_intent_id_fk" FOREIGN KEY ("checkout_id","intent_id") REFERENCES "public"."checkout_attempts"("id","intent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_unresolved_checkout" ON "checkout_attempts" USING btree ("intent_id") WHERE "checkout_attempts"."state" IN ('PENDING','CREATING','UNKNOWN','READY');--> statement-breakpoint
CREATE INDEX "checkout_order_reconcile" ON "checkout_attempts" USING btree ("last_checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_fulfillment_per_intent" ON "provider_payments" USING btree ("intent_id") WHERE "provider_payments"."disposition"='FULFILLED';