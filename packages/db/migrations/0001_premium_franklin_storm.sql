CREATE TABLE "booking_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_event_type" UNIQUE("booking_id","type")
);
--> statement-breakpoint
CREATE TABLE "booking_items" (
	"booking_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"seat_label" text NOT NULL,
	"fare_minor" integer NOT NULL,
	CONSTRAINT "booking_items_booking_id_seat_label_pk" PRIMARY KEY("booking_id","seat_label"),
	CONSTRAINT "booking_item_identity" UNIQUE("booking_id","trip_id","seat_label"),
	CONSTRAINT "item_fare_bounds" CHECK ("booking_items"."fare_minor" > 0 AND "booking_items"."fare_minor" <= 2500000)
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'HELD' NOT NULL,
	"total_minor" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_reference_unique" UNIQUE("reference"),
	CONSTRAINT "booking_id_trip" UNIQUE("id","trip_id"),
	CONSTRAINT "booking_unpaid_state" CHECK ("bookings"."status" IN ('HELD', 'EXPIRED', 'CANCELLED')),
	CONSTRAINT "booking_money" CHECK ("bookings"."total_minor" > 0 AND "bookings"."total_minor" <= 10000000 AND "bookings"."currency" = 'INR')
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"principal_id" text NOT NULL,
	"scope" text NOT NULL,
	"key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"http_status" integer,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_principal_id_scope_key_pk" PRIMARY KEY("principal_id","scope","key")
);
--> statement-breakpoint
CREATE TABLE "seat_allocations" (
	"trip_id" uuid NOT NULL,
	"seat_label" text NOT NULL,
	"booking_id" uuid NOT NULL,
	CONSTRAINT "seat_allocations_trip_id_seat_label_pk" PRIMARY KEY("trip_id","seat_label")
);
--> statement-breakpoint
CREATE TABLE "trip_seats" (
	"trip_id" uuid NOT NULL,
	"seat_label" text NOT NULL,
	"position" integer NOT NULL,
	"fare_minor" integer NOT NULL,
	CONSTRAINT "trip_seats_trip_id_seat_label_pk" PRIMARY KEY("trip_id","seat_label"),
	CONSTRAINT "trip_seat_position" UNIQUE("trip_id","position"),
	CONSTRAINT "seat_fare_bounds" CHECK ("trip_seats"."fare_minor" > 0 AND "trip_seats"."fare_minor" <= 2500000)
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"operator_name" text NOT NULL,
	"departure_at" timestamp with time zone NOT NULL,
	"arrival_at" timestamp with time zone NOT NULL,
	"sales_close_at" timestamp with time zone NOT NULL,
	"sales_state" text DEFAULT 'OPEN' NOT NULL,
	CONSTRAINT "trip_time_order" CHECK ("trips"."arrival_at" > "trips"."departure_at" AND "trips"."sales_close_at" < "trips"."departure_at"),
	CONSTRAINT "trip_sales_state" CHECK ("trips"."sales_state" IN ('OPEN', 'CLOSED', 'CANCELLED'))
);
--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_booking_id_trip_id_bookings_id_trip_id_fk" FOREIGN KEY ("booking_id","trip_id") REFERENCES "public"."bookings"("id","trip_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_trip_id_seat_label_trip_seats_trip_id_seat_label_fk" FOREIGN KEY ("trip_id","seat_label") REFERENCES "public"."trip_seats"("trip_id","seat_label") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_principal_id_user_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_allocations" ADD CONSTRAINT "seat_allocations_booking_id_trip_id_seat_label_booking_items_booking_id_trip_id_seat_label_fk" FOREIGN KEY ("booking_id","trip_id","seat_label") REFERENCES "public"."booking_items"("booking_id","trip_id","seat_label") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_seats" ADD CONSTRAINT "trip_seats_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_pending_booking_per_customer_trip" ON "bookings" USING btree ("trip_id","user_id") WHERE "bookings"."status" = 'HELD';--> statement-breakpoint
CREATE INDEX "booking_due_expiry" ON "bookings" USING btree ("trip_id","expires_at") WHERE "bookings"."status" = 'HELD';--> statement-breakpoint
CREATE INDEX "allocation_booking" ON "seat_allocations" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "trip_departure" ON "trips" USING btree ("departure_at");