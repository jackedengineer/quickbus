import { parseArgs } from 'node:util';
import {
  requestTripCancellation,
  type TripCancellationReason,
  tripCancellationReasons,
  tripCancellationStatus,
} from '../packages/backend/src/trip-cancellation';
import { createDatabase } from '../packages/db/src/client';

// Read-only by default; the bounded execute command stops sales atomically and
// leaves resumable batches to the existing minute worker. No admin API needed.
const { values } = parseArgs({
  options: {
    trip: { type: 'string' },
    actor: { type: 'string' },
    reason: { type: 'string' },
    'max-affected': { type: 'string' },
    'confirm-database': { type: 'string' },
    execute: { type: 'boolean', default: false },
  },
});
if (!values.trip || !/^[0-9a-f-]{36}$/i.test(values.trip))
  throw Error('Use --trip <UUID>. Without --execute this only reads status.');
const url = new URL(process.env.DATABASE_URL ?? '');
const database = url.pathname.slice(1);
if (
  process.env.CI_DATABASE_PROXY ||
  !['quickbus', 'kwikbus_v0'].includes(database) ||
  url.searchParams.get('sslmode') !== 'verify-full' ||
  !url.username.endsWith('_runtime') ||
  (database === 'kwikbus_v0' &&
    (process.env.DEPLOYMENT_ENV !== 'production' ||
      process.env.APP_ORIGIN !== 'https://kwikbus.jacked.dev')) ||
  (database === 'quickbus' && process.env.DEPLOYMENT_ENV !== 'local')
)
  throw Error('Use the approved TLS runtime connection and environment.');
const runtime = createDatabase(url.toString());
try {
  if (values.execute) {
    const max = values['max-affected'];
    if (
      values['confirm-database'] !== database ||
      !values.actor ||
      !tripCancellationReasons.includes(
        values.reason as TripCancellationReason,
      ) ||
      !max ||
      !/^\d+$/.test(max)
    )
      throw Error(
        'Execute requires --confirm-database <name> --actor <operator-slug> --reason OPERATOR_CANCELLED|SCHEDULE_CORRECTION|DEMO_RECOVERY --max-affected <reviewed-count>.',
      );
    console.log(
      JSON.stringify(
        await requestTripCancellation(
          runtime.db,
          values.trip,
          values.actor,
          values.reason as TripCancellationReason,
          Number(max),
        ),
      ),
    );
  }
  console.log(
    JSON.stringify(await tripCancellationStatus(runtime.db, values.trip)),
  );
} finally {
  await runtime.close();
}
