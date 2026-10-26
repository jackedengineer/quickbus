# KwikBus operational signals

## Questions and signals

| Question | Signal | First action |
|---|---|---|
| Is the public app usable? | Scheduled Production health workflow: homepage, DB readiness, auth configuration, sellable trips; three attempts before failing. | Open the failed step and check the bounded error code, then verify normal HTTPS in a browser. |
| Where did request latency go? | X-Request-Id links web/API JSON events. Server-Timing exposes wall-clock web/API/binding/session/email/command/tripLock durations. | Find request_completed and dependency_completed for that UUID in Workers Logs. Compare route/status distributions and p95/p99 in query results. |
| Are OTP requests failing? | email dependency_completed ok=false and auth route failure rates. | Inspect Resend delivery/errors for the user's reported time. Never paste codes or recipient data into logs. Provider acceptance is not inbox delivery. |
| Are resources exhausted? | Cloudflare Workers Metrics: errors/outcomes (including exceededCpu), CPU and wall time by Worker. | Check web and API separately; correlate with request failures. No paid plan is enabled automatically. |

## Privacy and interpretation

All public requests receive a server-generated UUID. The private API accepts the web-generated UUID only in UUID format. Routes use bounded templates; no query string, email, user/booking/trip identifier, headers, body, OTP or provider response is logged. Unknown routes become `other`. Start server functions use a bounded route template. Idle-pool failures retain the creating request/job UUID. `binding` measures the web-to-API call, while `api` identifies API Worker handling time. Timing numbers are wall clock, not CPU time. The web request span ends when response headers are ready, not after every streamed byte; parallel dependency totals can exceed request wall time. Do not add them together as a critical path. Existing callback invocation URL logging stays disabled.

Request events provide route/status/duration samples, not a separate Prometheus service. Cloudflare's existing metrics supply invocation/error/CPU aggregates. Worker logs have account retention/volume limits; this is a portfolio baseline, not guaranteed long-term telemetry storage. Empty samples do not establish a latency percentile or SLO.

## Failure response

The external monitor runs four times an hour on GitHub Actions, without credentials and without sending OTP or creating reservations. Schedules can be delayed by GitHub; it is not a guaranteed 15-minute detection service. A failed workflow provides an Actions annotation and run URL; notification delivery follows the repository owner's GitHub Actions notification settings. Verify those settings and the drill result rather than claiming a delivered page/email.

- `DATABASE_NOT_READY` / `PROBE_UNAVAILABLE`: check Workers errors, Neon status and readiness; retain the working deployment when investigating. Retry with normal DNS/TLS; never disable certificate verification.
- `NO_SELLABLE_INVENTORY`: inspect the inventory renewal heartbeat/horizon and upcoming DB trips; do not insert client-only fallback trips.
- `AUTH_CONFIGURATION_INVALID`: compare runtime allowlisted secrets/configuration with the approved origin and sender. Never bulk-upload the production environment file.
- `HOME_NOT_RENDERED` / `HTTP_5xx`: check web/API versions against the release record; roll back compatible Worker versions when the current release caused the failure.
- OTP failure spike: inspect the provider, credentials/sender and quotas; preserve rate limits. Read-only health checks do not certify actual email delivery, so repeat the real sign-in flow after remediation.

## Alert drill

Run `node scripts/check-production.mjs --failure-drill`: it must fail after three attempts with `INTENTIONAL_MONITOR_DRILL`, without touching production. Once the workflow is on main, dispatch Production health with failure_drill=true and inspect the failed run/annotation; then dispatch it normally and confirm green. Record actual results in the P0 evidence. Recipient inbox delivery is a separate observation and must not be inferred from an Actions failure.

## Official references

- [Workers observability](https://developers.cloudflare.com/workers/observability/)
- [Workers CPU and invocation limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Scheduled workflow limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
