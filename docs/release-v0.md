# KwikBus V0 preview — 25 October 2026

Historical `v0.0.1-preview` record. The domain and email rollout below were completed in [`v0.0.2-preview`](domain-cutover.md); current live site: https://kwikbus.jacked.dev/. Preserve this baseline for version comparison.

Live: https://kwikbus.ichiragbhugra.workers.dev/

This is a public portfolio preview using demonstration journeys and unpaid, ten-minute seat reservations. It does not issue travel tickets or accept payments. Google sign-in is live. Email OTP is implemented and verified locally, but intentionally disabled in production until the user registers and verifies `kwikbus.in`. The user explicitly chose to wait instead of using the existing `jacked.dev` sender.

## Delivered

TanStack Start web Worker `kwikbus` reaches Express Worker `kwikbus-api` through a service binding. The API has no workers.dev route or public preview URL. Neon project **KwikBus** contains a clean `kwikbus_v0` database with its own `kwikbus_v0_runtime` role and independent auth secret. Development and preview databases share the project's compute; this is database/credential isolation, not separate infrastructure fault domains.

Google project **KwikBus** (`kwikbus-portfolio-2026`) has an external, published OAuth client with exact localhost and temporary production callbacks. Only basic identity scopes are requested. Google may display the hosting domain in its public consent UI until brand/domain verification is completed. No passwords, password reset, magic links or unused OTP inspection endpoints are exposed. Session renewal/clearing cookies propagate through the service binding and SSR without mixing users.

Home search, city suggestions, calendar, 1–4 adults, route swapping, date switching, sorting, results, seat drawer, Google/email sign-in, account/sign-out, My bookings, release, help, privacy, terms and error/empty states use the FlixBus visual system. At 1280px, the reference and implementation results have a 768px column at x=256, a 44px date strip at y=243, and the first card at y=410. KwikBus branding, real supported controls, per-adult fare labels, a small timetable and truthful demo copy are intentional differences. Unsupported FlixBus filters, tracking and commercial promotions are not rendered as working features. This is not a claim of pixel identity for every competitor variant or unbuilt screen.

## Runtime evidence

- Real production browser: guest selects 2D → Google → selected seat restored → hold → full reload → release. A second run selects two adults and seats 4C/4D → Google → both selections restored → ₹1,498 hold → full reload → release. Both Workers and the production database participate. The final deployed recovery fix also returns an authenticated Google retry to the selected seats and closes the account dialog.
- Real 390px browser frame: keyboard search for two adults → select 3A and 3B → email OTP via local Mailpit → selections restored → atomic party hold → release. The frame hosts the real app and real API; it is not a mocked screenshot. Native device/viewport automation was unreliable, so this is responsive browser evidence, not a physical-phone certification.
- Wrong OTP rejection, logout propagation across tabs, expired session recovery from My bookings, Back/Forward seat-drawer navigation, help accordion, privacy/terms navigation, and private SSR identity isolation were checked. Results have no horizontal overflow at 320, 390, 768, 1024 and 1280px.
- [Current contention evidence](evidence/v0-concurrency-2026-10-25.json): 100 customers across two separate API instances, one winner, 99 conflicts, zero partial parties. Nine scenarios cover same-key replay, overlapping parties, lazy expiry, post-lock sales deadlines, bounded lock waits, customer-level uniqueness, injected rollback and independent SQL auditing. The source fingerprint is checked against the release implementation. This is correctness evidence, not a production latency/load SLO.
- Ten supplemental integration checks pass, including concurrent OTP redemption and SSR renewal-cookie forwarding. Build, lint, strict TypeScript and both Worker bundles pass.
- Full dependency audit has no high/critical advisories after pinning Miniflare's Undici to 7.30.1. The pre-existing moderate esbuild advisory remains in Drizzle Kit's deprecated tooling chain; no esbuild development server is exposed.
- Production HTML uses per-request script nonces, private/no-store, HSTS, nosniff, no-referrer and restricted permissions. Worker invocation URL logs are disabled so OAuth callback codes are not recorded. Request bodies are bounded at 16 KiB before reaching the private API. No credentials were found in tracked sources, Git patches or the client bundle.

Screenshots use demo data and exclude OTPs, cookies, OAuth secrets and personal profile details: [desktop home](evidence/v0/home-desktop.png), [results](evidence/v0/results-desktop.png), [production party hold](evidence/v0/party-hold-production.png), [released party](evidence/v0/party-release-production.png), [mobile home](evidence/v0/home-mobile.png), [mobile seat picker](evidence/v0/seats-mobile.png), [email OTP dialog](evidence/v0/email-otp-mobile.png), [mobile hold](evidence/v0/party-hold-mobile.png), [mobile release](evidence/v0/party-release-mobile.png), and [public sign-in](evidence/v0/public-signin.png).

## Deployment and rollback

With reviewed commits and the correct Cloudflare account authenticated:

```sh
pnpm install --frozen-lockfile --ignore-scripts
CLOUDFLARE_ENV=production pnpm check
pnpm cf:check
pnpm audit --audit-level=high
pnpm exec wrangler deploy -c apps/api/wrangler.jsonc --env production
pnpm exec wrangler deploy -c apps/web/dist/server/wrangler.json
```

The web build selects its Cloudflare environment at build time. Do not run a default development build between the production build and web deployment. API secrets are DATABASE_URL, AUTH_SECRET, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET; add RESEND_API_KEY only after sender verification. Never bulk-upload the entire .env.production file: it contains the migration owner URL. Deploy secrets through an explicit allowlist. Do not put owner credentials, fixture flags or Mailpit in a Worker.

The deployment IDs and source revision are recorded in [the deployment manifest](evidence/v0-deployment.json). Roll back a Worker with `pnpm exec wrangler rollback <version-id> -c <config-path>` (add `--env production` for the API). Roll back compatible application versions first; do not automatically reverse database migrations or restore away newer reservations. This release uses additive, previously applied schema migrations.

The reference hero photograph remains a third-party asset; its ownership, source and permission/replacement requirement are recorded in [asset provenance](ui-reference.md). It is not KwikBus-owned artwork.

The free Workers account has a 10ms CPU budget per request. Successful live flows have been verified; monitor Metrics for exceededCpu before expanding traffic. No paid plan was activated. Vite emits an upstream SSR CSS sourcemap warning; production rendering/hydration were verified, but CSS stack-map accuracy is not certified.

## Inventory operations

The production demo seed adds the next 30 days (90 journeys), using the direct migration owner connection and a seed advisory lock. It preserves reservations and refuses the wrong database/environment. Rerun weekly or before each demo/release:

```sh
CONFIRM_DEMO_INVENTORY=kwikbus_v0 node --env-file=.env.production --import tsx scripts/seed-production.ts
```

Do not run fixture tests or the contention runner against production. Automatic timetable publishing, retention jobs, alerts, disaster-recovery drills and administration remain later work in the main plan.

## Remaining launch work

1. Register `kwikbus.in`; connect its DNS/HTTPS to the web Worker. Keep the API private.
2. Verify a Resend sending domain and configure a sending-only API key scoped to that domain. Resend login is prepared; no KwikBus key or sender was created while domain ownership was pending. Verify the account's domain allowance before making changes; preserve unrelated senders and keys.
3. Enable and verify real email OTP delivery, resend rotation, wrong/expired/reused codes and the reservation return on the public site.
4. Add the owned-domain Google callback and branding/policy URLs; switch APP_ORIGIN with the frontend domain. Existing workers.dev cookies will require a fresh sign-in on the new domain. Configure support mailboxes after DNS is ready.
5. Keep payments and confirmed tickets disabled until the separate provider/idempotency/reconciliation gates pass. Admin provisioning and fresh MFA are mandatory before any admin endpoints are introduced.

[Worker limits](https://developers.cloudflare.com/workers/platform/limits/), [Cloudflare build environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/), [Better Auth configuration](authentication.md), and [asset provenance](ui-reference.md).
