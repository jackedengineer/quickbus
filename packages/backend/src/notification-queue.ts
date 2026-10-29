import type { Database, Transaction } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';

export type NotificationKind = 'CONFIRMED' | 'CANCELLED';
export type NotificationClaim = {
  id: string;
  bookingId: string;
  kind: NotificationKind;
  leaseToken: string;
  attempts: number;
};
export async function enqueueBookingNotification(
  tx: Transaction,
  bookingId: string,
  kind: NotificationKind,
) {
  await tx.execute(sql`INSERT INTO booking_notifications(id,booking_id,kind)
    VALUES(${crypto.randomUUID()},${bookingId},${kind}) ON CONFLICT(booking_id,kind) DO NOTHING`);
}
export async function claimBookingNotification(
  db: Database,
  bookingId?: string,
) {
  // Crashes count as attempts too; a killed worker cannot loop indefinitely.
  await db.execute(sql`UPDATE booking_notifications SET state='NEEDS_REVIEW',failure_code='RETRY_EXHAUSTED',lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
    WHERE attempts>=16 ${bookingId ? sql`AND booking_id=${bookingId}::uuid` : sql``} AND (state='QUEUED' OR (state='RUNNING' AND lease_expires_at<=clock_timestamp()))`);
  return (
    await db.execute<NotificationClaim>(sql`WITH candidate AS (
    SELECT id FROM booking_notifications WHERE attempts<16 ${bookingId ? sql`AND booking_id=${bookingId}::uuid` : sql``} AND
      ((state='QUEUED' AND available_at<=clock_timestamp()) OR (state='RUNNING' AND lease_expires_at<=clock_timestamp()))
    ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
    UPDATE booking_notifications n SET state='RUNNING',attempts=n.attempts+1,lease_token=${crypto.randomUUID()},
      lease_expires_at=clock_timestamp()+interval '45 seconds',updated_at=clock_timestamp()
    FROM candidate c WHERE n.id=c.id RETURNING n.id,n.booking_id AS "bookingId",n.kind,n.lease_token AS "leaseToken",n.attempts`)
  ).rows[0];
}
export async function notificationHealth(db: Database) {
  return (
    await db.execute<{
      pending: number;
      failed: number;
      oldestSeconds: number;
    }>(sql`SELECT
    count(*) FILTER(WHERE state IN ('QUEUED','RUNNING'))::int AS pending,
    count(*) FILTER(WHERE state='NEEDS_REVIEW')::int AS failed,
    coalesce(extract(epoch FROM clock_timestamp()-min(available_at) FILTER(WHERE state IN ('QUEUED','RUNNING'))),0)::int AS "oldestSeconds"
    FROM booking_notifications`)
  ).rows[0];
}
