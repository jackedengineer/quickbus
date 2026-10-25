import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import type { Database } from '@quickbus/db';
import * as authSchema from '@quickbus/db/auth-schema';
import { betterAuth } from 'better-auth';
import { magicLink, twoFactor } from 'better-auth/plugins';

export type AuthEnvironment = {
  AUTH_SECRET: string;
  APP_ORIGIN: string;
  DEPLOYMENT_ENV: string;
  MAILPIT_URL?: string;
};

export function createAuth(db: Database, environment: AuthEnvironment) {
  return betterAuth({
    appName: 'QuickBus',
    baseURL: environment.APP_ORIGIN,
    secret: environment.AUTH_SECRET,
    trustedOrigins: [environment.APP_ORIGIN],
    // Cloudflare overwrites this header at the public edge; don't trust forwarded-for.
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 20 },
    plugins: [
      magicLink({
        storeToken: 'hashed',
        expiresIn: 600,
        sendMagicLink: async ({ email, url }) => {
          if (
            environment.DEPLOYMENT_ENV !== 'local' ||
            !environment.MAILPIT_URL
          ) {
            throw new Error(
              'A production email adapter must be configured before deployment.',
            );
          }
          const endpoint = new URL(environment.MAILPIT_URL);
          if (!['localhost', '127.0.0.1'].includes(endpoint.hostname)) {
            throw new Error(
              'The local mail adapter accepts loopback addresses only.',
            );
          }
          const response = await fetch(new URL('/api/v1/send', endpoint), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              From: { Email: 'hello@quickbus.test', Name: 'QuickBus' },
              To: [{ Email: email }],
              Subject: 'Your QuickBus sign-in link',
              Text: `Sign in to QuickBus: ${url}\nThis link expires in ten minutes and works once.`,
            }),
          });
          if (!response.ok)
            throw new Error('The local email service is unavailable.');
        },
      }),
      twoFactor({ allowPasswordless: true }),
    ],
  });
}
