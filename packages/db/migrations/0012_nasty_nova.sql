CREATE TABLE "booking_notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_attempt_at" timestamp with time zone,
	"request_hash" text,
	"provider_id" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_booking_kind" UNIQUE("booking_id","kind"),
	CONSTRAINT "notification_kind" CHECK ("booking_notifications"."kind" IN ('CONFIRMED','CANCELLED')),
	CONSTRAINT "notification_state" CHECK ("booking_notifications"."state" IN ('QUEUED','RUNNING','SENT','NEEDS_REVIEW','SKIPPED')),
	CONSTRAINT "notification_attempts" CHECK ("booking_notifications"."attempts" BETWEEN 0 AND 16),
	CONSTRAINT "notification_lease" CHECK (("booking_notifications"."state"='RUNNING' AND "booking_notifications"."lease_token" IS NOT NULL AND "booking_notifications"."lease_expires_at" IS NOT NULL) OR ("booking_notifications"."state"<>'RUNNING' AND "booking_notifications"."lease_token" IS NULL AND "booking_notifications"."lease_expires_at" IS NULL)),
	CONSTRAINT "notification_request_identity" CHECK (("booking_notifications"."first_attempt_at" IS NULL AND "booking_notifications"."request_hash" IS NULL) OR ("booking_notifications"."first_attempt_at" IS NOT NULL AND "booking_notifications"."request_hash" IS NOT NULL AND "booking_notifications"."request_hash" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "notification_sent_identity" CHECK ("booking_notifications"."state"<>'SENT' OR "booking_notifications"."provider_id" IS NOT NULL),
	CONSTRAINT "notification_failure" CHECK ("booking_notifications"."failure_code" IS NULL OR "booking_notifications"."failure_code" IN ('DELIVERY_UNCERTAIN','RETRY_EXHAUSTED','CONFIGURATION_CHANGED','LEGACY_NOT_SCHEDULED','DELIVERY_REJECTED'))
);
--> statement-breakpoint
ALTER TABLE "booking_notifications" ADD CONSTRAINT "booking_notifications_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_due" ON "booking_notifications" USING btree ("available_at") WHERE "booking_notifications"."state" IN ('QUEUED','RUNNING');
--> statement-breakpoint
-- Existing confirmations predate automatic email delivery. Do not send old mail.
INSERT INTO booking_notifications(id,booking_id,kind,state,failure_code)
SELECT gen_random_uuid(),b.id,'CONFIRMED','SKIPPED','LEGACY_NOT_SCHEDULED'
FROM bookings b WHERE EXISTS(SELECT 1 FROM booking_events WHERE booking_id=b.id AND type='CONFIRMED');
