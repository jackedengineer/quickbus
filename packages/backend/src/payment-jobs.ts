import type { Database, Transaction } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';

export type JobKind = 'ORDER' | 'RECONCILE' | 'REFUND' | 'INBOX';
export type PaymentJob = {
  id: string;
  kind: JobKind;
  resourceId: string;
  leaseToken: string;
  attempts: number;
};

export async function enqueuePaymentJob(
  tx: Transaction,
  kind: JobKind,
  resourceId: string,
) {
  await tx.execute(sql`INSERT INTO payment_jobs(id,kind,resource_id)
    VALUES (${crypto.randomUUID()},${kind},${resourceId})
    ON CONFLICT(kind,resource_id) DO NOTHING`);
}

// One short autocommit claim; SKIP LOCKED distributes work across invocations.
// Fencing checks expiry as well as token, so even an unreclaimed stale worker
// cannot acknowledge work after its lease. Side effects need business guards too.
export async function claimPaymentJob(
  db: Database,
): Promise<PaymentJob | undefined> {
  const rows = await db.execute<PaymentJob>(sql`
    WITH candidate AS (
      SELECT id FROM payment_jobs WHERE attempts<32 AND
      ((state='QUEUED' AND available_at<=clock_timestamp()) OR
       (state='RUNNING' AND lease_expires_at<=clock_timestamp()))
      ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
    ) UPDATE payment_jobs j SET state='RUNNING',attempts=j.attempts+1,
      lease_token=${crypto.randomUUID()},
      lease_expires_at=clock_timestamp()+interval '45 seconds',
      updated_at=clock_timestamp()
    FROM candidate c WHERE j.id=c.id
    RETURNING j.id,j.kind,j.resource_id AS "resourceId",
      j.lease_token AS "leaseToken",j.attempts`);
  return rows.rows[0];
}

// Call inside the same transaction as the business transition when possible.
// false means the caller must roll back its domain writes.
export async function finishPaymentJob(
  tx: Transaction,
  job: PaymentJob,
  delaySeconds?: number,
) {
  if (
    delaySeconds !== undefined &&
    (!Number.isInteger(delaySeconds) || delaySeconds < 1 || delaySeconds > 3600)
  )
    throw new Error('Invalid payment job delay.');
  const result = await tx.execute(sql`UPDATE payment_jobs SET
    state=${delaySeconds === undefined ? 'DONE' : 'QUEUED'},
    attempts=${delaySeconds === undefined ? sql`attempts` : 0},
    available_at=clock_timestamp()+${delaySeconds ?? 0}*interval '1 second',
    lease_token=NULL,lease_expires_at=NULL,failure_code=NULL,updated_at=clock_timestamp()
    WHERE id=${job.id} AND state='RUNNING' AND lease_token=${job.leaseToken}
    AND lease_expires_at>clock_timestamp() RETURNING id`);
  return result.rowCount === 1;
}

export async function failPaymentJob(
  db: Database,
  job: PaymentJob,
  code: 'PROVIDER_UNAVAILABLE' | 'PROCESSING_FAILED',
) {
  const delay = Math.min(900, 5 * 2 ** Math.min(job.attempts, 8));
  await db.execute(sql`UPDATE payment_jobs SET
    state=${job.attempts >= 8 ? 'FAILED' : 'QUEUED'},
    failure_code=${job.attempts >= 8 ? 'RETRY_EXHAUSTED' : code},
    available_at=clock_timestamp()+${delay}*interval '1 second',
    lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
    WHERE id=${job.id} AND state='RUNNING' AND lease_token=${job.leaseToken}
    AND lease_expires_at>clock_timestamp()`);
}

export async function paymentJobHealth(db: Database) {
  const result = await db.execute<{
    pending: number;
    failed: number;
    oldestSeconds: number;
  }>(sql`
    SELECT count(*) FILTER(WHERE state IN ('QUEUED','RUNNING'))::int AS pending,
      count(*) FILTER(WHERE state='FAILED' OR (state='RUNNING' AND attempts>=32))::int AS failed,
      coalesce(extract(epoch FROM clock_timestamp()-min(available_at)
        FILTER(WHERE state IN ('QUEUED','RUNNING'))),0)::int AS "oldestSeconds"
    FROM payment_jobs`);
  return result.rows[0];
}
