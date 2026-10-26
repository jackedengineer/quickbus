import type pg from 'pg';

// Explicitly synthetic, versioned input for owner tooling. Runtime reads rows.
export async function seedCatalog(client: pg.Client) {
  const cities = [
    [
      'bengaluru',
      'Bengaluru',
      'Bangalore',
      'Majestic Demo Terminal',
      'Silk Board Demo Stop',
    ],
    [
      'hyderabad',
      'Hyderabad',
      'Hyderabad',
      'MGBS Demo Terminal',
      'Gachibowli Demo Stop',
    ],
    [
      'chennai',
      'Chennai',
      'Madras',
      'Koyambedu Demo Terminal',
      'Guindy Demo Stop',
    ],
    ['pune', 'Pune', 'Poona', 'Swargate Demo Terminal', 'Wakad Demo Stop'],
    ['mumbai', 'Mumbai', 'Bombay', 'Dadar Demo Terminal', 'Borivali Demo Stop'],
  ];
  for (const [id, name, alias, first, second] of cities) {
    await client.query(
      'INSERT INTO cities(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [id, name],
    );
    for (const value of new Set([id, name.toLowerCase(), alias.toLowerCase()]))
      await client.query(
        'INSERT INTO city_aliases(alias,city_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [value, id],
      );
    for (const [index, label] of [first, second].entries())
      await client.query(
        `INSERT INTO stops(id,city_id,name,address) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [
          `${id}-${index + 1}`,
          id,
          label,
          `Synthetic pickup/drop location in ${name}; portfolio demonstration only.`,
        ],
      );
  }
  for (const [id, name] of [
    ['kwikbus-demo', 'KwikBus Demo'],
    ['southern-demo', 'Southern Demo'],
    ['deccan-demo', 'Deccan Demo'],
  ])
    await client.query(
      'INSERT INTO operators(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [id, name],
    );
  await client.query(
    `INSERT INTO layouts(id,name,vehicle_label,seat_count) VALUES('seater-40','40-seat 2+2','AC Seater (2+2)',40) ON CONFLICT DO NOTHING`,
  );
  await client.query(`INSERT INTO layout_seats(layout_id,label,position)
    SELECT 'seater-40',((n-1)/4+1)::text||substr('ABCD',(n-1)%4+1,1),n FROM generate_series(1,40) n ON CONFLICT DO NOTHING`);
  for (const [id, origin, destination, operator, hour, fare, minutes] of [
    [
      'demo-blr-hyd-20',
      'bengaluru',
      'hyderabad',
      'kwikbus-demo',
      20,
      74900,
      600,
    ],
    [
      'demo-blr-hyd-22',
      'bengaluru',
      'hyderabad',
      'kwikbus-demo',
      22,
      89900,
      600,
    ],
    [
      'demo-hyd-blr-21',
      'hyderabad',
      'bengaluru',
      'kwikbus-demo',
      21,
      79900,
      600,
    ],
    [
      'demo-blr-chn-21',
      'bengaluru',
      'chennai',
      'southern-demo',
      21,
      64900,
      480,
    ],
    ['demo-pnq-bom-18', 'pune', 'mumbai', 'deccan-demo', 18, 49900, 240],
  ] as const) {
    const route = `${origin}-${destination}`;
    await client.query(
      'INSERT INTO routes(id,origin_city_id,destination_city_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [route, origin, destination],
    );
    const added = await client.query(
      `INSERT INTO inventory_services(id,origin,destination,operator_name,vehicle_label,departure_local_time,travel_minutes,sales_lead_minutes,seat_count,route_id,operator_id,layout_id)
      SELECT $1,a.name,b.name,o.name,l.vehicle_label,make_time($5,0,0),$6,30,l.seat_count,$7,o.id,l.id
      FROM cities a,cities b,operators o,layouts l WHERE a.id=$2 AND b.id=$3 AND o.id=$4 AND l.id='seater-40'
      ON CONFLICT DO NOTHING RETURNING id`,
      [id, origin, destination, operator, hour, minutes, route],
    );
    if (added.rowCount)
      await client.query(
        `INSERT INTO inventory_service_seats(service_id,label,position,fare_minor)
      SELECT $1,label,position,$2 FROM layout_seats WHERE layout_id='seater-40'`,
        [id, fare],
      );
    // Expand existing demo definitions only; preserve fare/time/operator edits.
    await client.query(
      `UPDATE inventory_services SET route_id=$2,operator_id=$3,layout_id='seater-40'
      WHERE id=$1 AND route_id IS NULL AND operator_id IS NULL AND layout_id IS NULL`,
      [id, route, operator],
    );
    await client.query(
      `INSERT INTO inventory_service_stops(service_id,stop_id,role,sequence,offset_minutes) VALUES
      ($1,$2,'PICKUP',1,0),($1,$3,'PICKUP',2,20),($1,$4,'DROP',3,$6::int-20),($1,$5,'DROP',4,$6)
      ON CONFLICT DO NOTHING`,
      [
        id,
        `${origin}-1`,
        `${origin}-2`,
        `${destination}-2`,
        `${destination}-1`,
        minutes,
      ],
    );
  }
}

export async function backfillTripCatalog(client: pg.Client) {
  let count = 0;
  for (let batch = 0; batch < 100; batch++) {
    // Trip lock shares the mutation boundary. Never infer a customer's choice;
    // this only fills the published menu, and never replaces existing snapshots.
    const result = await client.query(`WITH pending AS (
      SELECT t.id,t.departure_at,s.id service_id,s.route_id,s.operator_id,r.origin_city_id,r.destination_city_id
      FROM trips t JOIN inventory_services s ON s.id=t.source_service_id JOIN routes r ON r.id=s.route_id
      WHERE t.route_id IS NULL OR NOT EXISTS(SELECT 1 FROM trip_stops p WHERE p.trip_id=t.id)
      ORDER BY t.departure_at,t.id LIMIT 20 FOR UPDATE OF t
    ), updated AS (
      UPDATE trips t SET route_id=p.route_id,operator_id=p.operator_id,origin_city_id=p.origin_city_id,destination_city_id=p.destination_city_id
      FROM pending p WHERE t.id=p.id RETURNING t.id
    ), copied AS (
      INSERT INTO trip_stops(id,trip_id,source_stop_id,city_id,name,address,role,sequence,scheduled_at)
      SELECT gen_random_uuid(),p.id,st.id,st.city_id,st.name,st.address,d.role,d.sequence,p.departure_at+d.offset_minutes*interval '1 minute'
      FROM pending p JOIN inventory_service_stops d ON d.service_id=p.service_id JOIN stops st ON st.id=d.stop_id
      WHERE NOT EXISTS(SELECT 1 FROM trip_stops existing WHERE existing.trip_id=p.id) RETURNING trip_id
    ) SELECT (SELECT count(*)::int FROM updated) affected,(SELECT count(*)::int FROM copied) stops`);
    count += result.rows[0].affected;
    if (!result.rows[0].affected) return count;
  }
  throw new Error('Catalog backfill exceeded its bounded 2,000-trip budget.');
}
