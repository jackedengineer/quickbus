# Acceptance hardening — 31 October 2026

The customer preview remains on the free Cloudflare plan by explicit user choice.
The 15-minute capacity exercise **failed** its acceptance thresholds; it is not a
50-request/second capacity claim. Admin and live money remain out of scope.
[Load evidence](evidence/acceptance-2026-10-31/load.json),
[browser evidence](evidence/acceptance-2026-10-31/browser.json).

## Mobile responsiveness

A fresh 390 × 844 mobile/touch, 4× CPU/Fast 4G trace reproduced search INP
458 ms (126 input/238 processing/93 presentation), CLS 0. Search now paints its
acknowledgement before synchronous navigation work. The first local sample was
232 ms: retain that miss. Repeats measured 34, 51, 25 and 24 ms. Final public
HTTPS searches measured **42, 37 and 27 ms**, with CLS 0. These are small lab
samples, not physical-device tests or field percentiles.

A later map→list switch reproduced 345 ms, including 214 ms presentation. Reusing
the row content instead of recreating its children measured 89 ms. An experimental
`content-visibility` change was rejected: offscreen accessible names disappeared
in the actual browser. The shipped list retains all 40 names and keyboard stops.

The API Worker is explicitly placed near its Singapore Neon database. Same-public-
database catalogue execution samples changed from 612/569/569/574 ms to
53/36/39/37/86/60 ms. Full HTTP samples still ranged 433–1488 ms; service-binding
and client network latency remain visible. No availability/session cache was added.
[Cloudflare placement](https://developers.cloudflare.com/workers/configuration/placement/).

## Checkout recovery

Each hosted attempt opens in a fresh same-origin `/checkout` document inside an
application-owned dialog. Close/Return remains outside the opaque provider frame.
Closing destroys the SDK document without reloading the reservation or creating
another order. Fetches and SDK loading have deadlines. The child rereads the owned
server quote and time budget; neither amount nor provider key comes from its URL.

The parent validates exact message origin, frame window, active checkout ID and
message shape. Browser success only requests server verification. Existing trip
locks, post-lock deadlines, provider signatures, immutable evidence, idempotency
and compensation rules remain authoritative. A due/running/failed reconciliation
blocks reopen. An owned status read wakes due, leased recovery work rather than
waiting for the next minute tick. Network errors use recoverable copy.

HTTPS embedding is allowed only for the same-origin checkout document. Other
pages retain DENY/frame-ancestors none, nonce CSP and the private API binding.
Local actual hosted failure → explicit retry → capture → ticket → cancellation →
processed full INR749 refund passed, with zero allocations and all 24 invariants.
An offline 390 px hosted document could not load; outer Return still worked.
Online reopen used the saved order, and normal release succeeded. Public Google/OTP, hosted failure/retry, confirmed ticket/reload, cancellation and
processed full INR499 refund passed. [Immutable Worker/deployment manifest](evidence/acceptance-2026-10-31/deployment.json).

## Accessibility review

Run `node scripts/browser-a11y.mjs <DevTools-page-ID> <state-label>` against the
actual browser. It uses axe-core 4.14.0 WCAG A/AA tags plus best practices and saves
only rules/selectors/counts. Start the pinned DevTools CLI with an isolated profile,
`--usageStatistics=false --performanceCrux=false`, before entering sign-in data.
Raw traces, codes, cookies and mail content must stay out of published evidence.

Fixed seat visible-name mismatches, the language badge's unsupported ARIA label,
calendar/passenger Escape and focus return, and seat-drawer focus restoration
across the temporary loading dialog. Actual Tab navigation reached seat 10D.
The selected seat list and email sign-in scan have zero violations. Calendar,
error and cancellation contrast findings marked incomplete were manually reviewed;
overlaid content is not a new contrast failure. The only retained own-text contrast
finding is the `.brand` logotype, covered by the explicit
[WCAG 1.4.3 logotype exception](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
No rule is globally disabled. A pre-fix checkout scan is retained as historical
evidence; the badge correction was verified on the final shell.

320 px ticket/drawer and 390 px checkout have no horizontal overflow. Reduced
motion, native print (previous user review), form errors and dialog focus were
reviewed. The user explicitly declined physical VoiceOver audio review. Vendor
frame accessibility is not certified. The ten-minute inventory deadline is
reported, not declared compliant via an unproven timing exception; a full
[WCAG timing assessment](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html)
remains outside this focused preview acceptance.

## Capacity and failure evidence

The isolated Neon fixture held 10,000 future trips, 400,000 seats, 100,000 terminal
historical bookings and 3,000 synthetic customer sessions. Two credential-gated,
payment-disabled Cloudflare Workers used real restricted-role Neon/TLS transactions.
The 15-minute k6 2.3.0 run targeted 45 reads + 5 mutations/second with route skew.
It completed 44,942 requests: search server p95 185 ms, mutation server p95 214 ms,
full HTTP p95 762/840 ms, unexpected errors 4.02%, and 60 dropped iterations.
The original HTTP/error/drop thresholds were not relaxed. A separate 60-second
popular-trip run at 5 reads + 10 writes/second also failed: 23.95% unexpected
errors, zero drops. All database invariants stayed zero and sampled lock waits
were small. Correct ownership is distinct from successful capacity acceptance.

Cloudflare tail confirmed `exceededCpu`: 28 of 199 sampled invocations, with
explicit CPU-limit exceptions. This explains a material part of the empty 503s;
it does not prove every failure has the same cause. The free plan permits 10 ms
CPU per request. The user chose to keep the free preview and record this limit,
so no billing change, hidden retries to pass the benchmark, custom auth shortcut,
or global pool was introduced.
[Limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time),
[pricing](https://developers.cloudflare.com/workers/platform/pricing/).

The 100-customer, two-Worker last-seat burst resolved to one owner and 99 seat
conflicts after explicit same-key retries: initially 19 platform failures and four
busy results; 25 dependency retries in total. All 24 invariants were zero and the
winner released normally. This proves recovery/ownership, not 100 successful
simultaneous responses. Failed diagnostic runs remain in the aggregate report.

## Reproduction and cleanup

`scripts/load-target.ts` permits only the pinned loopback CI fixture, or explicit
`--neon` with a separately created `kwikbus_load_YYYYMMDD` database, matching
restricted runtime URL, local fixture flags and origin `http://localhost:3002`.
Migrate/grant/seed that disposable database, then run `scripts/load-fixture.ts`.
`load-edge-config.ts --neon` creates ignored configs and an allowlisted runtime
secrets file; it never copies the owner URL. Deploy only the two named temporary
Workers with those configs. They reject requests without the private fixture token.

Use pinned `grafana/k6:2.3.0` (digest
`sha256:2dd4756ec6e14e62778916e1eb850108e4b499304c02df56760fa0bdb0fba0b8`).
Mount `tests/load` read-only at `/scripts`, and the ignored fixture directory at
`/fixtures`; set working directory `/scripts`, `FIXTURE=/fixtures/fixture.json`,
`SUMMARY=/fixtures/baseline-summary.json`, `EDGE_FIXTURE=true`, then run
`run --quiet baseline.mjs`. `HOT_TRIP=true` and explicit diagnostic rates/duration
select the separate hotspot exercise. No provider API is included in load latency.
Run `load-audit.ts --neon` independently; normal owned cleanup is available through
`load-cleanup.ts --neon --edge --execute` before removing disposable resources.

The Mac-only diagnostic CI database initially saturated SCRAM startup; the load-
only password-protocol profile was isolated to its disposable Docker role/network.
It was not production performance evidence. Its original HBA was restored. Both
owned temporary edge Workers and the marked Neon fixture database were removed
after the final zero-invariant audit. Production credentials, data, callbacks,
DNS and unrelated Mac applications/services were preserved.
