import type { Database } from '@kwikbus/db';
import { renewalQuery } from '@kwikbus/db/inventory';

export async function renewInventory(db: Database) {
  // One snapshot/statement publishes all seats with their trips. Repeated and
  // overlapping invocations converge on the source-service/departure constraint.
  const result = await db.execute<{ created: number; invalid: number }>(
    renewalQuery(),
  );
  if (result.rows[0].invalid)
    throw new Error(
      'An active inventory service has an incomplete seat layout.',
    );
  return result.rows[0].created;
}
