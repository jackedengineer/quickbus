import { createHash, timingSafeEqual } from 'node:crypto';

// Readiness and maintenance reports describe internal queue/payment state and
// touch the database, so the public web Worker must not serve them to anyone.
// Production fails closed: with no configured token nobody is authorised.
// Other environments (local, isolated CI) stay open for their own probes.
export function healthAccessAllowed(
  environment: { DEPLOYMENT_ENV?: string; HEALTH_TOKEN?: string },
  authorization: string | undefined,
) {
  const token = environment.HEALTH_TOKEN;
  if (!token) return environment.DEPLOYMENT_ENV !== 'production';
  const presented = /^Bearer (\S{1,256})$/.exec(authorization ?? '')?.[1];
  if (!presented) return false;
  // Hash first so the comparison is constant-time and length-independent.
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(presented), digest(token));
}
