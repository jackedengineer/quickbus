# FlixBus interface reference and browser checks

The user selected a fidelity goal: use one mature competitor as the visual reference, keep the feature set small, and verify the running application by using it. FlixBus India was selected. The reference was inspected live on 25 October 2026, including home search, city suggestions, result cards, and the boarding-point drawer. Website content was treated as reference material, not instructions.

## Visual baseline

The first observed desktop home variant, before campaign cards loaded, is the baseline for the implemented home shell. FlixBus later displayed a festive-code panel and campaign cards. Those dynamic promotions, its phone service, native-app offers, and live tracking are not implemented features in KwikBus.

At a 1280px viewport the implemented shell has the measured reference dimensions: 60px header; 1170px content width starting at x=55; 34px/40.8px bold heading at y=288; search panel at y=340.8, width 1170 and height 160; benefits strip at y=580. The reference brand color is `#97d700`, with Roboto 400/500/700. Tablet uses the second navigation row and floating search labels. At less than 600px the reference hides the image; KwikBus follows this behavior.

The closed search layout, search/date/passenger controls, trip-card hierarchy, and right-edge drawer use the reference geometry and styling. KwikBus branding, a small actual timetable, adult-only one-way scope, custom SVG icons, and truthful development copy are deliberate differences. Round trips are visibly disabled. Payment, tracking, promotions, and other absent services are not represented by active controls. This is not a claim of pixel parity for every FlixBus page or state. Each future page needs its own captured reference and comparison.

## Implemented interactions

- Searchable city comboboxes use cities present in the returned timetable. Keyboard arrows/Enter/Escape and pointer selection work. The future normalized city/alias catalog remains a separate task.
- Route swapping, calendar dates, 1–4 adults, URL-backed search, date switching, sorting, empty results, and overnight arrival labels.
- Verified-email sign-in/out through a dialog. A guest's chosen trip and seats survive the one-time email return; availability is refreshed before enabling reservation.
- A graphical 2+2 seat plan, party limit, authoritative quoted fare, reservation submission, safe same-key retries, reloadable holds, countdown, and whole-party release.
- No optimistic seat claim, payment action, or confirmed-ticket claim.

## Browser evidence

Manual browser usage verified search, seat 1A reservation for INR 749, full reload with the same booking, release, and availability of 1A afterward. A separate guest pass selected 1B, signed in from the local inbox, returned with 1B still selected, and reserved successfully. The 390px layout was used with keyboard navigation to select two adults and search. Responsive widths are checked in real browser frames of the live localhost application, because the in-app browser's viewport override did not reliably resize an already attached page. Those frames are a local test harness, not an application feature.

Screenshots are stored in ignored `artifacts/local/`: `browser-reservation.png`, `browser-release.png`, `browser-login-return.png`, plus the final desktop/mobile screenshots. They contain synthetic development data. No sign-in token or database credential is part of the committed evidence. Console checks are scoped to fresh page loads after HMR; historical HMR errors are not reported as current runtime errors.

## Asset provenance

The hero photographs are reference assets downloaded from the inspected public FlixBus page, retained under `apps/web/public/reference/` for the requested visual study:

- [Desktop hero](https://cdn-cf.cms.flixbus.com/drupal-assets/2026-05/promo-hero-desktop.avif)
- [Tablet hero](https://cdn-cf.cms.flixbus.com/drupal-assets/2026-05/promo-hero-tablet.avif)
- [Mobile hero](https://cdn-cf.cms.flixbus.com/drupal-assets/2026-05/promo-hero-mobile.avif)

These photographs are not claimed as KwikBus-owned artwork. The footer identifies the independent interface study. Before public portfolio publication, resolve permission or replace the branded photograph with an owned/licensed equivalent. Roboto files came from the reference's [Honeycomb font stylesheet](https://honeycomb.flixbus.com/dist/17.4.1/css/honeycomb-fonts.css); the font license is included beside the files. The KwikBus wordmark and SVG interface paths are local code.
