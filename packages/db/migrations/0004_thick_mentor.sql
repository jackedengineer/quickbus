CREATE TABLE "trip_stops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"source_stop_id" text NOT NULL,
	"city_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"role" text NOT NULL,
	"sequence" integer NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trip_stop_identity" UNIQUE("trip_id","id"),
	CONSTRAINT "trip_stop_sequence" UNIQUE("trip_id","sequence"),
	CONSTRAINT "trip_stop_bounds" CHECK ("trip_stops"."role" IN ('PICKUP','DROP') AND "trip_stops"."sequence" BETWEEN 1 AND 20)
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country" text DEFAULT 'IN' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	CONSTRAINT "cities_name_unique" UNIQUE("name"),
	CONSTRAINT "city_region" CHECK ("cities"."country"='IN' AND "cities"."timezone"='Asia/Kolkata')
);
--> statement-breakpoint
CREATE TABLE "city_aliases" (
	"alias" text PRIMARY KEY NOT NULL,
	"city_id" text NOT NULL,
	CONSTRAINT "city_alias_normalized" CHECK ("city_aliases"."alias"=lower(btrim("city_aliases"."alias")) AND length("city_aliases"."alias") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "layout_seats" (
	"layout_id" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "layout_seats_layout_id_label_pk" PRIMARY KEY("layout_id","label"),
	CONSTRAINT "layout_seat_position" UNIQUE("layout_id","position"),
	CONSTRAINT "layout_seat_bounds" CHECK ("layout_seats"."position" BETWEEN 1 AND 80 AND "layout_seats"."label" ~ '^[0-9]{1,2}[A-D]$')
);
--> statement-breakpoint
CREATE TABLE "layouts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"vehicle_label" text NOT NULL,
	"seat_count" integer NOT NULL,
	CONSTRAINT "layout_capacity" CHECK ("layouts"."seat_count" BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" text PRIMARY KEY NOT NULL,
	"origin_city_id" text NOT NULL,
	"destination_city_id" text NOT NULL,
	CONSTRAINT "route_direction" UNIQUE("origin_city_id","destination_city_id"),
	CONSTRAINT "route_distinct_cities" CHECK ("routes"."origin_city_id"<>"routes"."destination_city_id")
);
--> statement-breakpoint
CREATE TABLE "stops" (
	"id" text PRIMARY KEY NOT NULL,
	"city_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_service_stops" (
	"service_id" text NOT NULL,
	"stop_id" text NOT NULL,
	"role" text NOT NULL,
	"sequence" integer NOT NULL,
	"offset_minutes" integer NOT NULL,
	CONSTRAINT "inventory_service_stops_service_id_stop_id_role_pk" PRIMARY KEY("service_id","stop_id","role"),
	CONSTRAINT "service_stop_sequence" UNIQUE("service_id","sequence"),
	CONSTRAINT "service_stop_bounds" CHECK ("inventory_service_stops"."role" IN ('PICKUP','DROP') AND "inventory_service_stops"."sequence" BETWEEN 1 AND 20 AND "inventory_service_stops"."offset_minutes" BETWEEN 0 AND 4320)
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "route_id" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "origin_city_id" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "destination_city_id" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "operator_id" text;--> statement-breakpoint
ALTER TABLE "inventory_services" ADD COLUMN "route_id" text;--> statement-breakpoint
ALTER TABLE "inventory_services" ADD COLUMN "operator_id" text;--> statement-breakpoint
ALTER TABLE "inventory_services" ADD COLUMN "layout_id" text;--> statement-breakpoint
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_source_stop_id_stops_id_fk" FOREIGN KEY ("source_stop_id") REFERENCES "public"."stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_aliases" ADD CONSTRAINT "city_aliases_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_seats" ADD CONSTRAINT "layout_seats_layout_id_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."layouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_origin_city_id_cities_id_fk" FOREIGN KEY ("origin_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_destination_city_id_cities_id_fk" FOREIGN KEY ("destination_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_service_stops" ADD CONSTRAINT "inventory_service_stops_service_id_inventory_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."inventory_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_service_stops" ADD CONSTRAINT "inventory_service_stops_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_origin_city_id_cities_id_fk" FOREIGN KEY ("origin_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_destination_city_id_cities_id_fk" FOREIGN KEY ("destination_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_services" ADD CONSTRAINT "inventory_services_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_services" ADD CONSTRAINT "inventory_services_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_services" ADD CONSTRAINT "inventory_services_layout_id_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."layouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_route_departure" ON "trips" USING btree ("origin_city_id","destination_city_id","departure_at","id");