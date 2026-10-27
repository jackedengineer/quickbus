ALTER TABLE "payment_jobs" DROP CONSTRAINT "payment_job_lease";--> statement-breakpoint
CREATE INDEX "booking_customer_created" ON "bookings" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "payment_jobs" ADD CONSTRAINT "payment_job_lease" CHECK (("payment_jobs"."state"='RUNNING' AND "payment_jobs"."lease_token" IS NOT NULL AND "payment_jobs"."lease_expires_at" IS NOT NULL)
        OR ("payment_jobs"."state"<>'RUNNING' AND "payment_jobs"."lease_token" IS NULL AND "payment_jobs"."lease_expires_at" IS NULL));