import type { Database } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';
import {
  localNotificationMail,
  type NotificationEmail,
  type NotificationEnvironment,
  sendBookingEmail,
} from './notification-email';
import {
  claimBookingNotification,
  type NotificationClaim,
  repairConfirmationNotifications,
} from './notification-queue';

type Delivery = {
  reference: string;
  email: string | null;
  firstAttempt: string | null;
  requestHash: string | null;
  canRetry: boolean;
};
async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function deliverBookingNotification(
  db: Database,
  env: NotificationEnvironment,
  claim: NotificationClaim,
) {
  const ready = await db.transaction(async (tx) => {
    const row = (
      await tx.execute<Delivery>(sql`SELECT b.reference,b.contact_email AS email,n.first_attempt_at::text AS "firstAttempt",n.request_hash AS "requestHash",
      (n.first_attempt_at IS NULL OR n.first_attempt_at>clock_timestamp()-interval '23 hours') AS "canRetry"
      FROM booking_notifications n JOIN bookings b ON b.id=n.booking_id WHERE n.id=${claim.id} AND n.state='RUNNING'
      AND n.lease_token=${claim.leaseToken} AND n.lease_expires_at>clock_timestamp() FOR UPDATE OF n`)
    ).rows[0];
    if (!row) return null;
    const stop = async (code: string) => {
      await tx.execute(
        sql`UPDATE booking_notifications SET state='NEEDS_REVIEW',failure_code=${code},lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=${claim.id}`,
      );
      return null;
    };
    if (
      !row.email ||
      !env.APP_ORIGIN ||
      (!localNotificationMail(env) && !env.EMAIL_FROM)
    )
      return stop('DELIVERY_REJECTED');
    // Resend's key expires at 24h. Leave an hour of margin and never send again
    // after expiry. Mailpit has no provider deduplication: uncertain local sends stop.
    if (!row.canRetry || (localNotificationMail(env) && row.firstAttempt))
      return stop('DELIVERY_UNCERTAIN');
    const link = new URL('/', env.APP_ORIGIN);
    link.searchParams.set('view', 'review');
    link.searchParams.set('bookingId', claim.bookingId);
    const action = claim.kind === 'CONFIRMED' ? 'confirmed' : 'cancelled';
    const message: NotificationEmail = {
      from: localNotificationMail(env)
        ? 'hello@kwikbus.test'
        : (env.EMAIL_FROM ?? ''),
      to: row.email,
      subject: `Your KwikBus demo booking was ${action}`,
      text: `Your test booking ${row.reference} was ${action}.\n\nThis is a portfolio demo. No real travel ticket or real payment is involved.\n\nView your current booking, ticket and refund status:\n${link.href}\n\nSign in with the account used to book. Refunds may still be processing after cancellation.`,
    };
    const hash = await digest(JSON.stringify(message));
    if (row.requestHash && row.requestHash !== hash)
      return stop('CONFIGURATION_CHANGED');
    await tx.execute(
      sql`UPDATE booking_notifications SET first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),request_hash=${hash} WHERE id=${claim.id}`,
    );
    return message;
  });
  if (!ready) return;
  try {
    const providerId = await sendBookingEmail(env, ready, claim.id);
    await db.execute(sql`UPDATE booking_notifications SET state='SENT',provider_id=${providerId},failure_code=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
      WHERE id=${claim.id} AND state='RUNNING' AND lease_token=${claim.leaseToken} AND lease_expires_at>clock_timestamp()`);
  } catch {
    // Network/provider errors reveal no response body, recipient or auth headers.
    const terminal = localNotificationMail(env) || claim.attempts >= 8;
    await db.execute(sql`UPDATE booking_notifications SET state=${terminal ? 'NEEDS_REVIEW' : 'QUEUED'},failure_code=${claim.attempts >= 8 ? 'RETRY_EXHAUSTED' : 'DELIVERY_UNCERTAIN'},
      available_at=clock_timestamp()+${Math.min(900, 5 * 2 ** Math.min(claim.attempts, 8))}*interval '1 second',lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
      WHERE id=${claim.id} AND state='RUNNING' AND lease_token=${claim.leaseToken} AND lease_expires_at>clock_timestamp()`);
  }
}
export async function runBookingNotifications(
  db: Database,
  env: NotificationEnvironment,
  limit = 3,
) {
  await repairConfirmationNotifications(db);
  let processed = 0;
  for (let n = 0; n < limit; n++) {
    const claim = await claimBookingNotification(db);
    if (!claim) break;
    await deliverBookingNotification(db, env, claim);
    processed++;
  }
  return processed;
}
