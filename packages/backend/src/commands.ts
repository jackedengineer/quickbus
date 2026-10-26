import type { Database, Transaction } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import { expireTripHolds } from './expiry';
import { timed } from './telemetry';

export type Result = { status: number; body: Record<string, unknown> };
export const failure = (
  code: string,
  detail: string,
  status = 409,
): Result => ({
  status,
  body: { code, detail },
});

// The trip row is the serialization boundary for every inventory mutation.
// Read clock_timestamp only AFTER acquiring it: transaction now() can be stale.
export async function lockTrip(tx: Transaction, tripId: string) {
  await tx.execute(sql`SET LOCAL lock_timeout='2s'`);
  await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
  const trip = await timed('tripLock', () =>
    tx.execute<{
      sales_state: string;
      sales_close_at: string;
    }>(sql`
    SELECT sales_state,sales_close_at::text FROM trips WHERE id=${tripId} FOR UPDATE`),
  );
  if (!trip.rows[0]) return null;
  const clock = await tx.execute<{ timestamp: string }>(
    sql`SELECT clock_timestamp()::text AS timestamp`,
  );
  const timestamp = clock.rows[0].timestamp;
  await expireTripHolds(tx, tripId, timestamp);
  return { ...trip.rows[0], timestamp };
}

export async function idempotent(
  db: Database,
  userId: string,
  route: string,
  key: string,
  payload: unknown,
  operation: (tx: Transaction) => Promise<Result>,
) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const hash = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  return timed('command', () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout='2s'`);
      await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
      const claim = await tx.execute(sql`
      INSERT INTO idempotency_keys(principal_id,scope,key,request_hash) VALUES(${userId},${route},${key},${hash})
      ON CONFLICT DO NOTHING RETURNING key`);
      if (!claim.rowCount) {
        // A separate statement takes a fresh READ COMMITTED snapshot after a competing INSERT commits.
        const existing = await tx.execute<{
          request_hash: string;
          http_status: number;
          response: Record<string, unknown>;
        }>(sql`
        SELECT request_hash,http_status,response FROM idempotency_keys
        WHERE principal_id=${userId} AND scope=${route} AND key=${key}`);
        const saved = existing.rows[0];
        if (!saved || saved.http_status === null)
          throw new Error('Incomplete idempotency record');
        if (saved.request_hash !== hash)
          return failure(
            'IDEMPOTENCY_KEY_REUSED',
            'This request key was used for different details.',
            422,
          );
        return { status: saved.http_status, body: saved.response };
      }
      const result = await operation(tx);
      await tx.execute(sql`UPDATE idempotency_keys SET http_status=${result.status},response=${JSON.stringify(result.body)}::jsonb
      WHERE principal_id=${userId} AND scope=${route} AND key=${key}`);
      return result;
    }),
  );
}
