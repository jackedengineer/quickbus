# Owned-domain cutover — 26 October 2026

Target: **https://kwikbus.jacked.dev/**. Current usable preview: **https://kwikbus.ichiragbhugra.workers.dev/**.

Cloudflare reports the DNS zone active. The new hostname is attached to the frontend Worker and has a valid Cloudflare certificate. Authoritative Cloudflare DNS and public resolvers return its Cloudflare addresses. The local resolver, automated browser and user's browser still reach the previous Railway address and fail certificate verification. Keep the original preview canonical until normal browser HTTPS works. The new hostname temporarily redirects to that preview for visitors with fresh DNS. The final canonical switch is **pending**, not certified complete.

## Completed configuration

- GoDaddy remains the registrar. The user approved the authoritative nameserver change and completed GoDaddy's SMS verification. Assigned nameservers: `brett.ns.cloudflare.com` and `isla.ns.cloudflare.com`.
- Backed up the original 24-record GoDaddy export locally. Imported 21 application/email records, excluding provider-specific SOA and NS records. Compared names, types and complete values with a Cloudflare export, then independently queried the authoritative server. All values match. Existing A/CNAME records remain DNS-only. The existing `chat` CNAME TTL is one day instead of seven days because of Cloudflare's selector limit. No existing destination or mail policy changed.
- Added `kwikbus.jacked.dev` as a custom domain of web Worker `kwikbus`. `kwikbus-api` remains private, reached through the service binding. Neon data, users and reservations were preserved.
- Added the exact Google callback `https://kwikbus.jacked.dev/api/auth/callback/google`, retaining localhost and the temporary callback. Updated homepage, privacy and terms URLs and added the authorised domain `jacked.dev`. No identity scopes changed. Google branding verification remains separate from published basic-identity login.
- Created a dedicated Resend key with sending-only permission limited to the already verified `jacked.dev` domain. Saved it only in ignored local configuration and the API Worker secret. The sender is **KwikBus <signin@jacked.dev>**. Unrelated Resend keys/domains are intact.

DNS backups and provider screenshots are ignored under `artifacts/local/domain-migration-2026-10-26/`; they are not public repository artifacts. Credentials and sign-in codes are excluded from committed evidence.

## Actual browser verification

On the usable production preview: select seat 5A → email OTP → wrong code rejected → resend → earlier code rejected → latest code accepted → seat restored → ₹749 reservation → full reload → release. Resend reports both emails delivered; the code was read from this test message's provider preview. Recipient inbox placement was not independently inspected.

After signing out, Google sign-in returned to the same account and showed the reservation created through email OTP. Browser console errors: none. These checks use live Cloudflare Workers, Resend and the production Neon database.

[OTP reservation](evidence/domain-2026-10-26/production-otp-hold.png), [released seat](evidence/domain-2026-10-26/production-otp-release.png), [same reservation after Google](evidence/domain-2026-10-26/production-google-after-otp.png), and [configuration/runtime evidence](evidence/domain-cutover-2026-10-26.json).

The earlier [V0 contention proof](evidence/v0-concurrency-2026-10-25.json) remains evidence for the tagged V0 reservation implementation. This hostname change does not alter reservation transactions; it is not a claim that the old source fingerprint includes the new deployment configuration.

## Finish the cutover

1. Open `https://kwikbus.jacked.dev/` normally in the browser and confirm valid HTTPS. No resolver override or certificate-warning bypass counts as browser acceptance. Cache clearing through an internal browser URL was blocked by browser policy; wait for normal DNS propagation rather than bypassing it.
2. Set `APP_ORIGIN` in `apps/api/wrangler.jsonc` and `PUBLIC_ORIGIN` in `apps/web/wrangler.jsonc` to `https://kwikbus.jacked.dev`. Align the ignored `.env.production` APP_ORIGIN too. The source currently matches the temporary live preview origin.
3. Run `CLOUDFLARE_ENV=production pnpm check`, `pnpm cf:check`, deploy the API with `--env production`, then deploy `apps/web/dist/server/wrangler.json`. Do not rebuild with the development environment between production build and web deploy. Existing secrets persist; never bulk-upload `.env.production` because it contains the migration owner's URL.
4. Verify Google and email OTP on the owned hostname, selection preservation, reservation/reload/release, and a mobile-sized view. New-domain cookies require a fresh sign-in. Confirm legacy read URLs redirect to the owned hostname while legacy mutations return 421; confirm the API still has no public route.
5. Update this status, the deployment evidence and README; commit, push and verify CI. Keep the original callback during the transition; remove it only as an intentional later cleanup after rollback needs end.

The redirect handler preserves paths and queries, rejects mutations on a noncanonical origin, and assigns pathname separately so `//example.com` cannot replace the destination hostname. Five actual local Workers-runtime HTTP checks cover these behaviors. Wrangler's local upstream must represent the legacy host to avoid its normal development Location rewriting obscuring the result.

## Recovery

If the canonical switch fails, restore both origins to the temporary preview and redeploy the API then web. Keep the custom hostname and verified sender in place. Do not change nameservers back merely because a recursive resolver still caches the old wildcard answer. The original DNS export and original GoDaddy nameservers (`ns65.domaincontrol.com`, `ns66.domaincontrol.com`) are available if an independently diagnosed DNS-record incident requires a deliberate DNS rollback.

[Cloudflare custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) and [subdomain-zone availability](https://developers.cloudflare.com/dns/zone-setups/subdomain-setup/).
