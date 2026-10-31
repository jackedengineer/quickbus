# Remaining lifecycle acceptance — 31 October 2026

Baseline: `3811895` / v0.3.0-preview. Admin remains deferred. Preserve real
browser acceptance and all inventory/payment protections; never change a business
result to improve a benchmark. Raw traces, cookies and provider details stay in
ignored local artifacts. Publish aggregate measurements and synthetic screenshots.

## Mobile investigation

A fresh390×844 mobile/touch viewport,4×CPU/Fast4G on the public baseline
reproduced search INP458ms (input126/processing238/presentation93), CLS0.
The seat map→list switch measured78ms; the previous572ms result has not yet
reproduced. Search acknowledgement now paints before synchronous navigation work;
its first optimized local-build sample was232ms (69/93/70), still above200ms.
Retain that miss. Repeat on the final public build; do not equate loopback TTFB,
a lab sample, a physical device, or field percentiles.

## Isolated load fixture

`scripts/load-fixture.ts` refuses every target except the disposable loopback
`quickbus_ci` database/proxy. It creates10,000 complete trip snapshots,400,000
seat rows,100,000 terminal historical bookings/items/events, and synthetic
customer sessions. No provider API or production database is used. The generated
fixture includes test-only cookies and must never be published.

Use the existing pinned `infra/compose.ci.yml` stack and `scripts/setup-ci.ts`.
For this acceptance session, an ignored `.env.acceptance` changes only the local
origin to `http://localhost:3002`; serve the two API Workers on8787/8788. Build
and serve the frontend separately on3002. Do not overwrite the user's `.env`.

The normal correctness CI profile retains PostgreSQL SCRAM authentication. The
initial load smoke saturated that fixture startup path. A diagnostic single
WebSocket SELECT1 took529ms, including370ms for SCRAM; direct TCP took36ms.
The optional load-only protocol profile uses `host quickbus_ci quickbus_runtime
samenet password` ahead of the original pg_hba rules, preserving the original
file for restoration. It affects only the known disposable Docker database and
public fixture password; never production TLS, roles, secrets or networking.
Neon's frontend connection protocol uses password authentication/pipelining;
see the [driver configuration](https://github.com/neondatabase/serverless/blob/main/CONFIG.md#pipelineconnect-password--false).
Five parallel SELECT1 connections then took98–106ms instead of5.1–5.4seconds.
A5rps smoke passed with zero errors/drops; search p95 was96ms, mutations93ms.
This does not prove the50rps target or production Neon/TLS capacity.

Run k6 `grafana/k6@sha256:2dd4756ec6e14e62778916e1eb850108e4b499304c02df56760fa0bdb0fba0b8`
(v2.3.0). Mount only `tests/load` read-only at `/scripts`, and the ignored
`artifacts/local/load` directory at `/fixtures`; never mount environment files.
Use `FIXTURE=/fixtures/fixture.json`, `SUMMARY=/fixtures/baseline-summary.json`
and working directory `/scripts`, then `run --quiet baseline.mjs`.
The default is15minutes at45read+5mutation requests/second through two real
Workers. Reads skew70% toward20departures. Mutations cycle hold→details→release.
External payment latency is excluded and must be reported separately. Thresholds
remain search p95<500ms, mutation p95<750ms, errors<0.5%, zero dropped iterations.
Use READ_RATE/WRITE_RATE/DURATION only for explicitly labelled diagnostic runs.

After every run, execute `scripts/load-audit.ts` with the fixture environment.
It audits all24 invariants and records actual row/connection/lock counts. Restore
the original pg_hba file and reload PostgreSQL before correctness CI, or remove
only this disposable Compose stack after the acceptance work. Final sustained
capacity, browser payment recovery, accessibility and release records are pending.
