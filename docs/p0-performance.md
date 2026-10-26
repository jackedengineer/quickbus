# Browser performance investigation — 26 October 2026

Use actual Chrome DevTools traces as the UI acceptance evidence. The official CLI 1.12.0 runs an isolated Chrome profile with statistics/CrUX reporting disabled; it never attaches to the personal profile. Raw traces remain private because network/DOM captures may contain session or identity data. Published numbers are lab observations, not field percentiles or service guarantees.

## Formatter investigation

The first production four-person search at 390 × 844, 4× CPU slowdown and Fast 4G measured INP 280 ms / CLS 0. DevTools attributed 258 ms to processing, 7 ms to input delay and 15 ms to presentation. The date filter constructed an Intl formatter for every matching trip; cards, seat prices and timers also constructed new formatters repeatedly. All locale/time-zone options were fixed constants.

Reuse four fixed Intl formatters per module. They hold no customer data, preserve explicit Asia/Kolkata and currency semantics, and do not cache availability, sessions or reservations. A focused boundary check preserves the Indian midnight transition, weekday/time display and integer-paise formatting.

Supporting Node 24 lab: five runs of 1,000 calls to each of the four presentation functions measured `[335, 280, 283, 283, 299]` ms before and `[6, 6, 7, 5, 5]` ms after. This isolates formatter allocation cost; it does not substitute for browser measurement.

Repeated actual production searches at the same 390 × 844 / 4× CPU / Fast 4G settings measured INP `[318, 464, 116]` ms before and `[239, 90, 96]` ms after, with CLS 0 in every sample. Each sample loaded a fresh document with ordinary browser cache, then clicked Search for four adults against the same 93 persisted trip snapshots. Median INP fell from 318 to 96 ms. The first after sample still exceeded 200 ms; three observations are not a field percentile or a guarantee. Date/fare behavior, party limits and real flows passed. Retain the formatter reuse; further cold-interaction tuning remains P1. [Conditions and all samples](evidence/p0-2026-10-26/browser-performance.json).

## Other observations

- Initial guest desktop baseline (1200 × 2029, cold cache, no throttle): LCP 965 ms, TTFB 619 ms, CLS 0. P0's first rollout: LCP 781 ms, TTFB 591 ms, CLS 0. These single observations do not isolate the cause of the difference.
- Unthrottled mobile (390 × 844): LCP 717 ms, TTFB 599 ms, CLS 0. Guest seat-panel interaction measured maximum INP 54 ms.
- The focus-fix rollout's mobile cold load at 4× CPU / Fast 4G: LCP 879 ms, TTFB 469 ms, CLS 0. No console errors or warnings after a fresh load.
- Dialogs animate opacity/transform for 160 ms. Reduced motion must yield 0s / no animation. No layout property, countdown or page-load scene is animated. Frame-rate certification and physical-device performance are not claimed.
- One production readiness trace correlated web/binding/API events: web CPU 6 ms, API CPU 16 ms, both outcome `ok`. API wall time was 419 ms. It is not evidence of a consistent sub-10-ms CPU budget; watch platform resource outcomes and native metrics before choosing a paid plan or making capacity promises.

Server-side filtered/paginated search remains P1; the existing catalog endpoint is bounded and database-backed, but the browser still filters its small timetable. Broader traffic, accessibility and performance budgets remain under T27/T28. This P0 establishes measurements and removes a demonstrated allocation bottleneck.
