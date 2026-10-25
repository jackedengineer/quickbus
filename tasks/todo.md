# KwikBus task backlog

Implementation has started. Items remain unchecked until their full acceptance criteria have evidence. Cloudflare Workers is now required (ADR 010); payment task T02 is deferred until the seat-concurrency proof passes. Each task targets one focused session. Paths in future tasks are planned; the repository and evidence documents identify landed files. Keep a task to roughly 2–5 implementation/test files; split it further if scaffolding or integration expands that scope. Gates are review points, not permission requests embedded in application flows.

Commands refer to the [proposed command interface](plan.md). Before those scripts exist, a spike records its exact reproducible commands and output. Every later task also runs `pnpm check` and the affected build; focused verification is listed below.

## Current slice evidence

See [compatibility](../docs/compatibility.md), [reservation proof](../docs/reservation-proof.md), and [UI/browser reference](../docs/ui-reference.md). The real Neon/Workers seat proof and a usable search/reserve/release UI were brought forward. The [V0 preview](../docs/release-v0.md) now has published Google login, locally verified hashed/single-use email OTP, SSR isolation and cookie renewal. Public OTP awaits the owned sender domain. Fresh admin MFA remains open for future admin routes. T02 remains unimplemented. Later reservation/search items remain unchecked because catalog publication, stop snapshots, telemetry, and full acceptance have not all landed. The UI reference is now FlixBus, with per-page visual comparison required.

## Phase 0 — Verify the assumptions

- [x] **T01 — Framework, driver, and deployment compatibility spike**
  - Accept: pin a compatible stable version matrix; demonstrate Start and Express in Workers through a service binding, with a request-scoped Neon WebSocket/Drizzle transaction. Record pooled/direct URL use without secrets.
  - Verify: reproducible smoke commands, SSR response, transaction rollback and lock timeout evidence.
  - Depends: none. Targets: a disposable spike and `docs/compatibility.md`; retain findings, not a second app architecture. Size: M.

- [ ] **T02 — Payment-provider contract spike**
  - Accept: test order/receipt lookup, failed-attempt replacement, lost-response recovery, captured-state verification, signed duplicate events, and stable-key refund replay. Resolve documentation differences with observed test-mode behavior.
  - Verify: deterministic adapter tests plus sanitized Razorpay sandbox evidence; no real payment.
  - Depends: none. Targets: provider spike harness, fixtures, `docs/provider-contract.md`. Size: M.

- [ ] **T03 — Identity and policy review**
  - Accept: demonstrate verified-email login, explicit hashed email OTP storage, Google login and single-use code behavior, admin MFA, and request-scoped session handling. Review scope/cutoffs and record accepted changes to the PRD/ADRs.
  - Verify: concurrent token redemption test and two-user SSR isolation check.
  - Depends: T01. Targets: auth spike, auth tests, PRD/decision updates. Size: M.

**Gate A:** integration risks documented; accepted policy/capability boundaries recorded; estimates revised. No payment implementation depends on an unverified retry guarantee.

## Phase 1 — Find a departure

- [x] **T04 — Workspace task graph**
  - Accept: pnpm workspace and Turbo graph expose dev/check/build commands with explicit package exports and strict TS; lockfile and runtime version are pinned.
  - Verify: clean install and a task-graph/build smoke test.
  - Depends: T01. Targets: root package/workspace/Turbo/TS/runtime configuration, split scaffolder output as needed. Size: M.

- [ ] **T05 — Backend bootstraps and database harness**
  - Accept: API/worker consume a shared server-only backend package; validated config, bounded pools, redacted request/trace logs, health, graceful shutdown, and isolated real-Postgres test setup exist.
  - Verify: `pnpm test:integration` for rollback/health/start-stop; no frontend import of DB code.
  - Depends: T04. Targets: API entry, worker entry, DB client, config loader, harness test. Size: M.

- [ ] **T06 — Web shell and CI baseline**
  - Accept: Start shell renders responsively; CI runs install/check/unit/build and the PostgreSQL harness; task caching respects environment/database inputs.
  - Verify: `pnpm build`, first browser smoke, clean CI on an empty test DB.
  - Depends: T04, T05. Targets: web entry/root route, CI workflow, test configuration, import-boundary rule. Size: M.

**Gate B:** clean local/CI builds, no private dependency in the browser, real database harness ready.

- [ ] **T07 — Verified customer session vertical slice**
  - Accept: login/logout and safe return URL work; ownership is server-derived; admin roles cannot be self-assigned. Reuse the approved library configuration.
  - Verify: focused identity integration/E2E tests, CSRF and invalid-link cases.
  - Depends: T03, T06. Targets: generated auth schema migration, identity adapter, login route, auth integration/E2E test. Size: M.

- [ ] **T08 — Seeded catalog read slice**
  - Accept: cities/aliases/routes/operators/templates and a deterministic synthetic fixture support real city suggestions; published-trip search DTOs define date/ID validation and stable pagination for the next slices.
  - Verify: `pnpm test:contracts` and catalog SQL tests; search-contract cases include overnight dates and invalid routes.
  - Depends: T05, T07. Targets: catalog schema/migration, fixture, query/handler, contract test. Size: M.

- [ ] **T09 — Responsive search vertical slice**
  - Accept: city suggestions use the real API; date/party, URL state, result cards, and empty/error states use deterministic trip-contract fixtures until T11 binds published data. Arrival dates and fares are unambiguous.
  - Verify: `pnpm test:e2e` for search/reload/back and mobile/desktop screenshots.
  - Depends: T06, T08. Targets: search route, search form, result/filter components, browser test. Size: M.

**Gate C:** city suggestions are real and the departure UI is contract-tested; URL/timezone behavior verified. Trip results remain explicitly fixture-backed until publication and real search in T11.

## Phase 2 — Reserve correctly

- [ ] **T10 — Inventory and booking constraints**
  - Accept: trip/stop/seat snapshots, booking/items, current allocations, and command keys have reviewed migrations and composite/unique constraints. No deferred-feature tables.
  - Verify: migration up-from-empty/upgrade tests; invalid cross-trip FK and duplicate-allocation tests.
  - Depends: T08. Targets: booking schema, migration, fixture adapter, constraint tests. Size: M.

- [ ] **T11 — Atomic trip publication**
  - Accept: a valid draft publishes every stop/seat atomically; invalid/repeated publication cannot create partial/duplicate inventory. Replace T09 trip fixtures with booking-owned published-trip queries, without a reverse catalog dependency.
  - Verify: publication and search integration/contract tests; seed uses the same publication service; search browser flow runs on published DB data.
  - Depends: T09, T10. Targets: publication service, published-trip query/HTTP adapter, fixture update, integration/browser tests; split publication and read binding if scope expands. Size: M per focused subtask.

- [ ] **T12 — Atomic hold and command replay**
  - Accept: per-trip lock, post-lock time check, expired-claim retirement, whole-party allocation, immutable quote/deadline, and same-key/hash replay are implemented in one transaction; record lock/command latency from this slice onward.
  - Verify: focused hold/idempotency integration tests including injected rollback and response-loss recovery.
  - Depends: T07, T10, T11. Targets: hold service, booking repository, command-key helper, HTTP route, tests. Size: M.

**Gate D:** reviewed SQL and constraints; no partial publication or partial-party claim; no network calls in the critical transaction.

- [ ] **T13 — Multi-instance contention proof**
  - Accept: last-seat, overlapping-party, different-key/same-user, inverse-seat-order, and lock-expiry cases pass through two API instances. Add an independent invariant audit.
  - Verify: `pnpm test:contention`; persist seed/environment/result artifact.
  - Depends: T12. Targets: contention runner, barrier/fault fixture, invariant audit, result documentation. Size: M.

- [ ] **T14 — Seat-selection and hold UI**
  - Accept: trip details, stop choices, graphical/list seat selection, login return, conflict handling, and successful hold navigation work; no optimistic reservation claim.
  - Verify: browser flow with two customers contending; keyboard selection and party-limit checks.
  - Depends: T09, T12, T13. Targets: trip route, seat picker/list, reserve action, browser/a11y test. Size: M.

- [ ] **T15 — Checkout details and deadline**
  - Accept: names/contact/stop review and conditional detail edits work; timer survives reload/focus; expiry and <90-second initiation restriction are visible and server-enforced.
  - Verify: checkout E2E and stale-version/deadline integration cases.
  - Depends: T14. Targets: checkout route/form, details command, timer helper, tests. Size: M.

**Gate E:** complete browse→authenticate→reserve→review path; contention evidence reviewed before provider checkout is exposed.

## Phase 3 — Pay and recover

- [ ] **T16 — Durable inbox/outbox/job foundation**
  - Accept: transactional outbox dispatch, leased job claims, token-checked completion, bounded retry/backoff, and scheduled hold-expiry cleanup work; job locks end before business work; expose backlog age, failures, and worker heartbeat.
  - Verify: worker crash/lease/duplicate-dispatch integration tests.
  - Depends: T10, T12. Targets: infrastructure schema/migration, queue repository, runner, tests. Size: M.

- [ ] **T17 — Logical payment intent and checkout attempt**
  - Accept: details freeze, unique logical intent, one unresolved checkout attempt, deterministic receipt, provider creation outside locks, and UNKNOWN handling work. New attempts require verified prior failure.
  - Verify: adapter/DB tests for duplicate commands, declined retry, lost create response, and stale worker.
  - Depends: T02, T15, T16. Targets: payment schema/migration, preparation service, provider adapter, worker handler, tests. Size: M.

- [ ] **T18 — Common capture finalizer**
  - Accept: capture observation confirms only live owned inventory with matching money; late/additional captures create one compensation intent; failure cannot downgrade capture.
  - Verify: capture/expiry/reallocation/cancellation-order integration matrix.
  - Depends: T13, T17. Targets: observation contract, finalizer, payment repository, tests. Size: M.

**Gate F:** intent/attempt distinctions and financial invariants reviewed; unknown outcomes cannot create another order.

- [ ] **T19 — Signed webhook and callback intake**
  - Accept: raw-body verification, environment isolation, durable inbox ACK, duplicate hash checks, and verified callback-triggered fetch use the same finalizer.
  - Verify: invalid/mutated signature, DB-unavailable ACK behavior, duplicate/out-of-order and wrong-owner tests.
  - Depends: T16, T18. Targets: webhook route/middleware ordering, inbox processor, callback handler, tests. Size: M.

- [ ] **T20 — Hosted checkout and status UI**
  - Accept: sandbox checkout launches once per attempt; refresh/close/failure/pending/success/late-refund states have explicit actions and preserve useful details.
  - Verify: controlled-provider browser tests plus sanitized Razorpay sandbox walkthrough.
  - Depends: T17, T19. Targets: checkout launcher, booking detail route, query/status helpers, browser tests. Size: M.

- [ ] **T21 — Payment reconciliation and invariant cases**
  - Accept: periodic order/receipt/payment fetch resolves missing callbacks/webhooks, checks earlier attempts, and creates deduplicated owned cases for mismatches/ambiguity.
  - Verify: missing-event, paginated receipt lookup, unknown-order, extra-capture, and exhausted-retry tests.
  - Depends: T18, T19. Targets: reconcile scheduler/handler, case repository, provider fetch adapter, tests. Size: M.

**Gate G:** complete successful booking and late-capture compensation intent demonstrated; every observed capture has a visible disposition. Keep public checkout gated until actual refund execution below passes.

## Phase 4 — Complete the lifecycle

- [ ] **T22 — Ticket, owned history, and notification delivery**
  - Accept: customer list/detail and print ticket use immutable snapshots; confirmation email is outbox-driven, authorized, and deduplicated as far as provider guarantees allow.
  - Verify: two-user access tests, ticket/print browser review, duplicate-delivery test.
  - Depends: T20, T21. Targets: booking-list route, ticket component/print styles, delivery handler, tests. Size: M.

- [ ] **T23 — Whole-booking cancellation**
  - Accept: preview and command recheck policy under lock; terminal transition releases all allocations and atomically creates a unique full-refund intent if captured.
  - Verify: cutoff equality, stale preview, repeated/different keys, unpaid cancellation, capture race.
  - Depends: T18, T20. Targets: cancellation policy/service, HTTP contract/handler, customer dialog, tests. Size: M.

- [ ] **T24 — Refund execution and recovery**
  - Accept: stable provider key, exact amount, unknown-result reconciliation, processed/refused visibility, and excess-capture refunds work without reviving bookings.
  - Verify: sandbox refund plus lost-response, duplicate job/webhook, stale lease, and overspend guards.
  - Depends: T02, T16, T21, T23. Targets: refund worker/adapter, reconciliation job, refund-status UI, tests. Size: M.

**Gate H:** confirmed→cancelled→refunded and expired→late capture→refunded work end to end; no hidden financial exception is dropped.

- [ ] **T25 — Trip cancellation drain**
  - Accept: immediate sellability stop, resumable bounded booking drain, refund intents, and captures arriving after drain are safe in either race order.
  - Verify: crash/restart and mixed-state cancellation integration tests plus invariant audit.
  - Depends: T11, T21, T24. Targets: sale-state/cancel service, drain handler, progress query, tests. Size: M.

- [ ] **T26 — Admin authoring and exception UI**
  - Accept: provisioned admin can draft/publish/close/cancel trips, inspect redacted timelines/cases, and request allowlisted safe rechecks; every command is audited and MFA-protected.
  - Verify: admin browser journey, non-admin rejection, role-escalation and replay tests.
  - Depends: T03, T11, T21, T25. Targets: admin route/components, command composition, audit integration, tests; split authoring and cases if over five files. Size: M.

- [ ] **T27 — Lifecycle usability and accessibility pass**
  - Accept: mobile/desktop, keyboard/screen reader, seat list, form errors, timer warnings, print, and payment recovery meet the tested accessibility criteria; findings are fixed or explicitly release-blocking.
  - Verify: `pnpm test:a11y`, manual screen-reader record, focused browser regressions.
  - Depends: T22, T24, T26. Targets: affected UI components, focused browser tests, accessibility report; split fixes by page. Size: M.

**Gate I:** customer/admin lifecycle usable and accessible; admin recovery is operationally meaningful, not a dashboard mock.

## Phase 5 — Prove and release

- [ ] **T28 — Security, fault, and load evidence**
  - Accept: run all mandatory races/crash windows with real SQL, validate shared quotas/CSRF/SSR isolation, and publish measured warm/cold latency and invariant results with exact versions.
  - Verify: `pnpm test:faults`, `pnpm test:contention`, full contract/integration/browser suites, k6 baseline/hot-trip runs. Split any resulting fixes into focused tasks.
  - Depends: T21, T24, T25, T27. Targets: fault/load scenarios, invariant audit, benchmark manifest/report. Size: M for execution/reporting, remediation separate.

- [ ] **T29 — Deployment, migration, and restore drill**
  - Accept: immutable container deployment, single-origin routing, runtime secrets, health/shutdown, queue/error alerts, serialized migration, rollback, and isolated DB restore with provider reconciliation are demonstrated.
  - Verify: staging smoke, injected worker outage/alert, prior-schema upgrade, timed restore/RPO/RTO record. Split infrastructure setup from drill execution as needed.
  - Depends: T28. Targets: deployment configuration, release workflow, operating/restore runbook, evidence. Size: M per focused subtask.

- [ ] **T30 — Portfolio release package**
  - Accept: working sandbox URL, README walkthrough, API docs, ERD/ADRs, successful and failure-path demos, CI/test/load/restore evidence, and honest limitations are linked. All PRD release criteria reviewed.
  - Verify: a fresh reviewer can run seeded demo and reproduce the last-seat scenario using documented commands; scan public media for personal/payment secrets.
  - Depends: T29. Targets: README, evidence index, generated API documentation, demo media references. Size: M.

**Gate J:** release evidence reviewed, unresolved correctness/security failures closed, SLO claims match measurements. Deferred features remain deferred until this gate passes.
