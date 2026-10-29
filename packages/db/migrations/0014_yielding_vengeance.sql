CREATE TABLE "booking_cancellations" (
	"booking_id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"actor" text NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"refund_minor" integer NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cancellation_source" CHECK ("booking_cancellations"."source" IN ('CUSTOMER','TRIP')),
	CONSTRAINT "cancellation_actor" CHECK (length("booking_cancellations"."actor") BETWEEN 1 AND 100),
	CONSTRAINT "cancellation_policy" CHECK ("booking_cancellations"."policy_version"=1),
	CONSTRAINT "cancellation_refund_bounds" CHECK ("booking_cancellations"."refund_minor" BETWEEN 0 AND 10000000)
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancellation_policy_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_cancellations" ADD CONSTRAINT "booking_cancellations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "booking_cancellation_policy" CHECK ("bookings"."cancellation_policy_version"=1);