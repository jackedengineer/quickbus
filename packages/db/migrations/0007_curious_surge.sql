CREATE TABLE "payment_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_job_resource" UNIQUE("kind","resource_id"),
	CONSTRAINT "payment_job_kind" CHECK ("payment_jobs"."kind" IN ('ORDER','RECONCILE','REFUND','INBOX')),
	CONSTRAINT "payment_job_state" CHECK ("payment_jobs"."state" IN ('QUEUED','RUNNING','DONE','FAILED')),
	CONSTRAINT "payment_job_attempt_bounds" CHECK ("payment_jobs"."attempts" BETWEEN 0 AND 32),
	CONSTRAINT "payment_job_lease" CHECK (("payment_jobs"."state"='RUNNING') = ("payment_jobs"."lease_token" IS NOT NULL AND "payment_jobs"."lease_expires_at" IS NOT NULL)),
	CONSTRAINT "payment_job_failure_code" CHECK ("payment_jobs"."failure_code" IS NULL OR "payment_jobs"."failure_code" IN ('PROVIDER_UNAVAILABLE','PROCESSING_FAILED','RETRY_EXHAUSTED'))
);
--> statement-breakpoint
CREATE INDEX "payment_job_due" ON "payment_jobs" USING btree ("available_at") WHERE "payment_jobs"."state" IN ('QUEUED','RUNNING');