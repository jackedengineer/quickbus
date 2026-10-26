CREATE TABLE "inventory_service_seats" (
	"service_id" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"fare_minor" integer NOT NULL,
	CONSTRAINT "inventory_service_seats_service_id_label_pk" PRIMARY KEY("service_id","label"),
	CONSTRAINT "service_seat_position" UNIQUE("service_id","position"),
	CONSTRAINT "service_seat_bounds" CHECK ("inventory_service_seats"."position" BETWEEN 1 AND 80 AND "inventory_service_seats"."fare_minor" BETWEEN 1 AND 2500000 AND "inventory_service_seats"."label" ~ '^[0-9]{1,2}[A-D]$')
);
--> statement-breakpoint
CREATE TABLE "inventory_services" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"operator_name" text NOT NULL,
	"vehicle_label" text NOT NULL,
	"departure_local_time" time NOT NULL,
	"travel_minutes" integer NOT NULL,
	"sales_lead_minutes" integer NOT NULL,
	"seat_count" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "service_cities" CHECK (length("inventory_services"."origin") BETWEEN 1 AND 100 AND length("inventory_services"."destination") BETWEEN 1 AND 100 AND "inventory_services"."origin"<>"inventory_services"."destination"),
	CONSTRAINT "service_bounds" CHECK ("inventory_services"."travel_minutes" BETWEEN 1 AND 4320 AND "inventory_services"."sales_lead_minutes" BETWEEN 2 AND 1440 AND "inventory_services"."seat_count" BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "source_service_id" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "vehicle_label" text DEFAULT 'AC Seater (2+2)' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_service_seats" ADD CONSTRAINT "inventory_service_seats_service_id_inventory_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."inventory_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_source_service_id_inventory_services_id_fk" FOREIGN KEY ("source_service_id") REFERENCES "public"."inventory_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trip_service_departure" UNIQUE("source_service_id","departure_at");