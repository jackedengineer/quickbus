-- Referenced unique constraints must exist before the composite foreign keys.
ALTER TABLE "routes" ADD CONSTRAINT "route_identity" UNIQUE("id","origin_city_id","destination_city_id");
--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stop_city_identity" UNIQUE("id","city_id");
--> statement-breakpoint
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_source_stop_id_city_id_stops_id_city_id_fk" FOREIGN KEY ("source_stop_id","city_id") REFERENCES "public"."stops"("id","city_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_route_id_origin_city_id_destination_city_id_routes_id_origin_city_id_destination_city_id_fk" FOREIGN KEY ("route_id","origin_city_id","destination_city_id") REFERENCES "public"."routes"("id","origin_city_id","destination_city_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trip_catalog_pair" CHECK (("trips"."route_id" IS NULL AND "trips"."origin_city_id" IS NULL AND "trips"."destination_city_id" IS NULL) OR ("trips"."route_id" IS NOT NULL AND "trips"."origin_city_id" IS NOT NULL AND "trips"."destination_city_id" IS NOT NULL));
