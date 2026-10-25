import { createHmac } from 'node:crypto';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import type { Database } from '@kwikbus/db';
import * as authSchema from '@kwikbus/db/auth-schema';
import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins';
import { sendSignInCode } from './email';

export type AuthEnvironment = {
  AUTH_SECRET: string;
  APP_ORIGIN: string;
  DEPLOYMENT_ENV: string;
  MAILPIT_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
};

export function emailSignInEnabled(environment: AuthEnvironment) {
  return Boolean(
    (environment.DEPLOYMENT_ENV === 'local' && environment.MAILPIT_URL) ||
      (environment.RESEND_API_KEY && environment.EMAIL_FROM),
  );
}

export function createAuth(db: Database, environment: AuthEnvironment) {
  return betterAuth({
    appName: 'KwikBus',
    baseURL: environment.APP_ORIGIN,
    secret: environment.AUTH_SECRET,
    trustedOrigins: [environment.APP_ORIGIN],
    emailAndPassword: { enabled: false },
    // Authentication failures must never log OTPs, tokens, or provider responses.
    logger: { disabled: true },
    advanced: {
      useSecureCookies: environment.APP_ORIGIN.startsWith('https://'),
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    account: {
      encryptOAuthTokens: true,
      // Both methods prove email ownership; never link a different email.
      accountLinking: { enabled: true, allowDifferentEmails: false },
    },
    socialProviders:
      environment.GOOGLE_CLIENT_ID && environment.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: environment.GOOGLE_CLIENT_ID,
              clientSecret: environment.GOOGLE_CLIENT_SECRET,
              prompt: 'select_account',
              includeGrantedScopes: false,
            },
          }
        : {},
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 20 },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 5,
        resendStrategy: 'rotate',
        rateLimit: { window: 60, max: 3 },
        // A keyed hash also protects the small OTP space after a database leak.
        storeOTP: {
          hash: async (otp) =>
            createHmac('sha256', environment.AUTH_SECRET)
              .update(`kwikbus:sign-in:${otp}`)
              .digest('hex'),
        },
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== 'sign-in') throw new Error('Unsupported OTP purpose.');
          await sendSignInCode(environment, email, otp);
        },
      }),
    ],
  });
}
