ALTER TABLE "booking_events" DROP CONSTRAINT "booking_event_type";--> statement-breakpoint
ALTER TABLE "booking_events" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_items" ADD COLUMN "passenger_name" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "pickup_stop_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "drop_stop_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trip_id_pickup_stop_id_trip_stops_trip_id_id_fk" FOREIGN KEY ("trip_id","pickup_stop_id") REFERENCES "public"."trip_stops"("trip_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trip_id_drop_stop_id_trip_stops_trip_id_id_fk" FOREIGN KEY ("trip_id","drop_stop_id") REFERENCES "public"."trip_stops"("trip_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_event_version" UNIQUE("booking_id","type","version");--> statement-breakpoint
ALTER TABLE "booking_items" ADD CONSTRAINT "passenger_name_bounds" CHECK ("booking_items"."passenger_name" IS NULL OR (length("booking_items"."passenger_name") BETWEEN 2 AND 100 AND "booking_items"."passenger_name"=btrim("booking_items"."passenger_name") AND "booking_items"."passenger_name" !~ '[[:cntrl:]]'));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "booking_details_bounds" CHECK ("bookings"."version">0 AND (("bookings"."pickup_stop_id" IS NULL AND "bookings"."drop_stop_id" IS NULL) OR ("bookings"."pickup_stop_id" IS NOT NULL AND "bookings"."drop_stop_id" IS NOT NULL AND "bookings"."pickup_stop_id"<>"bookings"."drop_stop_id")) AND ("bookings"."contact_email" IS NULL OR length("bookings"."contact_email") BETWEEN 3 AND 254) AND ("bookings"."contact_phone" IS NULL OR "bookings"."contact_phone" ~ '^[+][1-9][0-9]{6,14}$'));