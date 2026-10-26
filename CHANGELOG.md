# Changelog

## v0.0.2-preview — 2026-10-26

### Changed

- KwikBus now opens at https://kwikbus.jacked.dev with Google and email OTP sign-in. The original preview links redirect to it.
- Verified two-seat Google booking on mobile and email OTP booking on desktop, including selection restoration, full reload and release. These remain unpaid demonstration reservations.

### Fixed

- Recover browsers that cached the earlier staging redirect without clearing their session cookies or application storage.

[Deployment and browser evidence](docs/domain-cutover.md).

## v0.0.1-preview — 2026-10-25

- Initial Cloudflare preview with Google sign-in, search, seat selection and unpaid reservation/release. [Release evidence](docs/release-v0.md).
