ALTER TABLE "bookings" DROP CONSTRAINT "booking_unpaid_state";--> statement-breakpoint
DROP INDEX "one_pending_booking_per_customer_trip";--> statement-breakpoint
DROP INDEX "booking_due_expiry";--> statement-breakpoint
CREATE UNIQUE INDEX "one_pending_booking_per_customer_trip" ON "bookings" USING btree ("trip_id","user_id") WHERE "bookings"."status" IN ('HELD','PAYMENT_PENDING');--> statement-breakpoint
CREATE INDEX "booking_due_expiry" ON "bookings" USING btree ("trip_id","expires_at") WHERE "bookings"."status" IN ('HELD','PAYMENT_PENDING');--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "booking_unpaid_state" CHECK ("bookings"."status" IN ('HELD','PAYMENT_PENDING','CONFIRMED','EXPIRED','CANCELLED'));