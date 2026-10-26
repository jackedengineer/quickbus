# Owned-domain cutover — 26 October 2026

**Complete. Live V0 preview: https://kwikbus.jacked.dev/**. The legacy Workers hostname redirects reads to the owned hostname and rejects mutations.

Normal DNS and certificate verification passed in the browser before switching both production origins. The private API was deployed first, then the frontend. Google and email OTP each passed actual selection → sign-in → reservation → full reload → release flows on the owned hostname. No certificate warning was bypassed and no resolver or browser security override was used.

## Completed configuration

- GoDaddy remains the registrar. The user approved the authoritative nameserver change and completed GoDaddy's SMS verification. Assigned nameservers: `brett.ns.cloudflare.com` and `isla.ns.cloudflare.com`.
- Backed up the original 24-record GoDaddy export locally. Imported 21 application/email records, excluding provider-specific SOA and NS records. Compared names, types and complete values with a Cloudflare export, then independently queried the authoritative server. All values match. Existing A/CNAME records remain DNS-only. The existing `chat` CNAME TTL is one day instead of seven days because of Cloudflare's selector limit. No existing destination or mail policy changed.
- Added `kwikbus.jacked.dev` as a custom domain of web Worker `kwikbus`. `kwikbus-api` remains private, reached through the service binding. Neon data, users and reservations were preserved.
- Added the exact Google callback `https://kwikbus.jacked.dev/api/auth/callback/google`, retaining localhost and the temporary callback. Updated homepage, privacy and terms URLs and added the authorised domain `jacked.dev`. No identity scopes changed. Google branding verification remains separate from published basic-identity login.
- Created a dedicated Resend key with sending-only permission limited to the already verified `jacked.dev` domain. Saved it only in ignored local configuration and the API Worker secret. The sender is **KwikBus <signin@jacked.dev>**. Unrelated Resend keys/domains are intact.

DNS backups and provider screenshots are ignored under `artifacts/local/domain-migration-2026-10-26/`; they are not public repository artifacts. Credentials and sign-in codes are excluded from committed evidence.

## Actual browser verification

On **kwikbus.jacked.dev**, using live Cloudflare Workers, Resend and production Neon:

- **Mobile, 390 × 844:** choose two adults, search Bengaluru → Hyderabad, select 6A/6B → Google sign-in through the owned-domain callback → both seats restored at ₹1,498 → reserve → full reload → release.
- **Desktop, 1280 × 720:** sign out, search and select 7A → email OTP → selection restored at ₹749 → reserve → full reload → release. Resend reported this test email delivered; its provider preview supplied the code. Recipient inbox placement was not independently inspected. The earlier Google reservation was visible after OTP sign-in, confirming the same account.
- Real viewport widths 320, 390, 768, 1024 and 1280 had matching document/scroll widths and no horizontal overflow. These are responsive browser checks, not physical-device certification. Browser warnings/errors: none. All holds created in this verification were released.
- Clean-root navigation and reload passed after cached-redirect recovery, including while signed in. Legacy reads return 308, legacy mutations 421, wrong-origin mutations 403, password sign-in 404 and oversized auth requests 413. The private API's public Workers URL returns 404. Google/email are enabled and the local mailbox is disabled.

[Mobile home](evidence/owned-domain-2026-10-26/mobile-home.png), [results](evidence/owned-domain-2026-10-26/mobile-results.png), [selected seats](evidence/owned-domain-2026-10-26/mobile-selected-seats.png), [Google reservation](evidence/owned-domain-2026-10-26/mobile-google-hold.png), [released seats](evidence/owned-domain-2026-10-26/mobile-google-release.png), [desktop home](evidence/owned-domain-2026-10-26/desktop-home.png), [OTP reservation](evidence/owned-domain-2026-10-26/desktop-otp-hold.png), [OTP release](evidence/owned-domain-2026-10-26/desktop-otp-release.png), [desktop results](evidence/owned-domain-2026-10-26/desktop-results.png), and [runtime/deployment evidence](evidence/domain-cutover-2026-10-26.json).

Earlier on the Workers preview, seat 5A passed wrong-code rejection, resend rotation, rejection of the earlier code, latest-code sign-in, restoration, reservation/reload/release, then Google sign-in to the same account. Those negative OTP checks are retained as preview evidence, separate from the new hostname's successful delivery/sign-in check. [Earlier screenshots](evidence/domain-2026-10-26/production-otp-hold.png).

The earlier [V0 contention proof](evidence/v0-concurrency-2026-10-25.json) remains evidence for the tagged V0 reservation implementation. This hostname change does not alter reservation transactions; it is not a claim that the old source fingerprint includes the new deployment configuration.

## Cached-redirect recovery

Real browser testing caught a loop: the previously cached owned-host → preview permanent redirect met the new preview → owned-host redirect. Legacy redirects now add `_kwikbus_domain=20261026` and `Cache-Control: private, no-store`, preserving the path and journey query. Assigning pathname separately keeps `//example.com` from replacing the destination hostname.

Only the canonical migration landing sends `Clear-Site-Data: "cache"`. This evicts that origin's cached redirect without clearing session cookies or application storage. The regular clean root does not send this header. Visiting the recovery landing while signed in preserved the session; subsequent clean-root navigation and reload succeeded. Cache eviction may delay the recovery navigation, so it is limited to that landing rather than every response. See the [W3C directive semantics](https://w3c.github.io/webappsec-clear-site-data/) and [Chromium implementation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/browsing_data/clear_site_data_utils.cc).

## Deployment and future verification

Both `apps/api/wrangler.jsonc` APP_ORIGIN and `apps/web/wrangler.jsonc` PUBLIC_ORIGIN now use `https://kwikbus.jacked.dev`; the ignored production environment file is aligned. Current API version: `387b5db3-c71b-47ea-ba5c-0f323fe8e9bf`; current web version: `1f20d19c-7e9d-429a-95e6-ea665d6b480d`.

For future deployments:

1. Review the diff and run `CLOUDFLARE_ENV=production pnpm check` and `pnpm cf:check`.
2. Deploy the API with `--env production`, then deploy `apps/web/dist/server/wrangler.json`. Do not rebuild with the development environment between production build and web deploy. Existing secrets persist; never bulk-upload `.env.production` because it contains the migration owner's URL.
3. Verify Google/email OTP, selection preservation, reservation/reload/release and mobile layouts. Confirm legacy redirects, wrong-origin rejection and private API routing. Keep the legacy Google callback until rollback needs end; removing it is a separate intentional change.
4. Update evidence and verify GitHub CI before tagging a release. This cutover is recorded as `v0.0.2-preview`; it remains an unpaid reservation demonstration, with no live tickets or payments.

## Recovery

If the canonical switch fails, restore both origins to the temporary preview and redeploy the API then web. Keep the custom hostname and verified sender in place. Do not change nameservers back merely because a recursive resolver still caches the old wildcard answer. The original DNS export and original GoDaddy nameservers (`ns65.domaincontrol.com`, `ns66.domaincontrol.com`) are available if an independently diagnosed DNS-record incident requires a deliberate DNS rollback.

[Cloudflare custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) and [subdomain-zone availability](https://developers.cloudflare.com/dns/zone-setups/subdomain-setup/).
