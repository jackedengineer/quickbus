CREATE TABLE "trip_cancellations" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"reason" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"processed_bookings" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "trip_cancellation_actor" CHECK ("trip_cancellations"."actor" ~ '^[a-z0-9][a-z0-9:_-]{0,59}$'),
	CONSTRAINT "trip_cancellation_reason" CHECK ("trip_cancellations"."reason" IN ('OPERATOR_CANCELLED','SCHEDULE_CORRECTION','DEMO_RECOVERY')),
	CONSTRAINT "trip_cancellation_progress" CHECK ("trip_cancellations"."processed_bookings">=0 AND ("trip_cancellations"."completed_at" IS NULL OR "trip_cancellations"."completed_at">="trip_cancellations"."requested_at"))
);
--> statement-breakpoint
ALTER TABLE "payment_jobs" DROP CONSTRAINT "payment_job_kind";--> statement-breakpoint
ALTER TABLE "trip_cancellations" ADD CONSTRAINT "trip_cancellations_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_trip_status" ON "bookings" USING btree ("trip_id","status","created_at","id");--> statement-breakpoint
ALTER TABLE "payment_jobs" ADD CONSTRAINT "payment_job_kind" CHECK ("payment_jobs"."kind" IN ('ORDER','RECONCILE','REFUND','INBOX','TRIP_CANCEL'));