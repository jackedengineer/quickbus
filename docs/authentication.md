# KwikBus passwordless authentication

V0 uses Better Auth 1.7.12 with the Drizzle PostgreSQL adapter, Google OpenID Connect and email OTP. Password sign-up, password sign-in, password reset, magic links, OTP inspection, email changes and customer MFA enrollment are not exposed. Future admin access requires a separately designed and verified MFA policy; the presence of an old two_factor table is not MFA enforcement.

Email codes contain six digits, expire after five minutes, allow five attempts, and rotate on resend. A keyed SHA-256 hash is stored in verification records; the key is the server-only AUTH_SECRET. Better Auth's pinned atomic consume is the gate for successful redemption. A supplemental two-instance integration check verifies one new session from concurrent use of the same code. Browser checks remain the acceptance evidence for customer flows. Resend requests are limited to three per minute per IP by Better Auth; authentication globally uses its database-backed limits. These limits are abuse controls, not a strict distributed billing quota. A production edge rule/Turnstile is the next protection if actual abuse appears.

Google requests only its default identity scopes. It does not request Gmail, Drive, offline Google access or incremental grants. OAuth tokens are encrypted at rest by Better Auth. Linking requires the same email and a verified local account; unverified email must not gain access to reservations. OAuth state and redirect checking remain enabled.

Session cookies are HTTP-only and SameSite=Lax, secure on HTTPS, with a seven-day renewable session. Every protected API call verifies the session on the server. No user ID comes from a client request. Mutations require the exact APP_ORIGIN. The API is private in production and only the web Worker service binding reaches it. Browser focus and cross-tab events refresh session state; booking lists remount when the signed-in user changes.

## Configuration

- Local: ignored .env, Mailpit on loopback, optional real Google client. scripts/dev.mjs copies only a runtime allowlist into ignored API .dev.vars.
- Production: separate database and runtime role, independent AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and RESEND_API_KEY in Worker secrets. Owner/migration URLs never enter a Worker or browser bundle.
- APP_ORIGIN is the single actual public origin. Google callback: APP_ORIGIN + /api/auth/callback/google. The owned target is https://kwikbus.jacked.dev; its Google callback is registered. During DNS propagation, APP_ORIGIN and the frontend PUBLIC_ORIGIN both remain https://kwikbus.ichiragbhugra.workers.dev so the existing preview stays usable. Switch both together only after normal browser HTTPS reaches the owned hostname; see [cutover status](domain-cutover.md). Old-origin sessions do not transfer across domains.
- Sender: KwikBus <signin@jacked.dev>. The existing jacked.dev Resend domain is verified. KwikBus has its own sending-only key restricted to that domain; unrelated senders/keys remain intact. Public delivery, wrong-code rejection, resend rotation, sign-in and reservation return were checked in the real browser. Never use the development inbox or a fake-success email adapter in production.
- Sign-in codes, OAuth codes, authorization headers, cookies and provider response bodies must not be logged. Worker invocation URL logs are disabled to avoid recording OAuth callback query parameters.

Google project: KwikBus, ID kwikbus-portfolio-2026. Client: KwikBus Web V0, server-side redirect flow. No browser JavaScript origins are needed for this flow. The Google support contact temporarily uses the account owner's existing Google address until the KwikBus support mailbox exists.

## Official sources

- [Better Auth email OTP](https://better-auth.com/docs/plugins/email-otp)
- [Better Auth Google](https://better-auth.com/docs/authentication/google)
- [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email)
