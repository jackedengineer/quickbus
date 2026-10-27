import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  claimPaymentJob,
  enqueuePaymentJob,
  failPaymentJob,
  finishPaymentJob,
} from '../../packages/backend/src/payment-jobs';
import { createDatabase } from '../../packages/db/src/client';
import { fixtureClient } from '../support/fixtures';

test('payment outbox rolls back, claims once, and fences stale completion', async () => {
  const owner = await fixtureClient();
  const a = createDatabase(
    process.env.DATABASE_URL ?? '',
    process.env.CI_DATABASE_PROXY,
  );
  const b = createDatabase(
    process.env.DATABASE_URL ?? '',
    process.env.CI_DATABASE_PROXY,
  );
  const resource = randomUUID(),
    rolledBack = randomUUID();
  try {
    await expect(
      a.db.transaction(async (tx) => {
        await enqueuePaymentJob(tx, 'ORDER', rolledBack);
        throw new Error('injected rollback');
      }),
    ).rejects.toThrow('injected rollback');
    expect(
      (
        await owner.query('SELECT id FROM payment_jobs WHERE resource_id=$1', [
          rolledBack,
        ])
      ).rowCount,
    ).toBe(0);
    await a.db.transaction(async (tx) => {
      await enqueuePaymentJob(tx, 'ORDER', resource);
      await enqueuePaymentJob(tx, 'ORDER', resource);
    });
    expect(await claimPaymentJob(a.db, rolledBack)).toBeUndefined();
    const claims = await Promise.all([
      claimPaymentJob(a.db, resource),
      claimPaymentJob(b.db, resource),
    ]);
    const job = claims.find((j) => j?.resourceId === resource);
    expect(job).toBeDefined();
    expect(claims.filter((j) => j?.resourceId === resource)).toHaveLength(1);
    if (!job) throw new Error('Missing claim');
    await owner.query(
      "UPDATE payment_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [job.id],
    );
    expect(await a.db.transaction((tx) => finishPaymentJob(tx, job))).toBe(
      false,
    );
    const replacement = await claimPaymentJob(b.db, resource);
    expect(replacement?.id).toBe(job.id);
    expect(replacement?.leaseToken).not.toBe(job.leaseToken);
    if (!replacement) throw new Error('Missing replacement');
    await failPaymentJob(a.db, job, 'PROCESSING_FAILED');
    expect(
      await b.db.transaction((tx) => finishPaymentJob(tx, replacement)),
    ).toBe(true);
    const row = (
      await owner.query(
        'SELECT state,attempts,lease_token FROM payment_jobs WHERE id=$1',
        [job.id],
      )
    ).rows[0];
    expect(row).toEqual({ state: 'DONE', attempts: 2, lease_token: null });
  } finally {
    await owner.query(
      'DELETE FROM payment_jobs WHERE resource_id=ANY($1::uuid[])',
      [[resource, rolledBack]],
    );
    await Promise.all([a.close(), b.close()]);
    await owner.end();
  }
});
