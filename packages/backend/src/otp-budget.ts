import { createHmac } from 'node:crypto';
import type { Database } from '@kwikbus/db';
import { sql } from '@kwikbus/db/schema';

export const OTP_SENDS_PER_ADDRESS = 5;
export const OTP_WINDOW_MS = 15 * 60 * 1000;

// Better Auth limits sign-in codes per client IP, which a distributed sender
// bypasses. This caps what any one mailbox can receive, so the sign-in form
// cannot be used to flood a victim or burn the sender's reputation and quota.
// It reuses Better Auth's rate_limit table (the runtime role already owns it)
// with an HMAC'd key, so no address is stored. One upsert makes the fixed
// window atomic across Workers. Returns false once the budget is spent.
export async function consumeOtpSend(
  db: Database,
  secret: string,
  email: string,
) {
  const key = `otp-address:${createHmac('sha256', secret)
    .update(email.trim().toLowerCase())
    .digest('hex')}`;
  const result = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limit(id,key,count,last_request)
    VALUES (${crypto.randomUUID()},${key},1,(extract(epoch FROM clock_timestamp())*1000)::bigint)
    ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN rate_limit.last_request<=EXCLUDED.last_request-${OTP_WINDOW_MS}::bigint
        THEN 1 ELSE rate_limit.count+1 END,
      last_request=CASE WHEN rate_limit.last_request<=EXCLUDED.last_request-${OTP_WINDOW_MS}::bigint
        THEN EXCLUDED.last_request ELSE rate_limit.last_request END
    RETURNING count`);
  return result.rows[0].count <= OTP_SENDS_PER_ADDRESS;
}
