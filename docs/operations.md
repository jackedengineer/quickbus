# KwikBus operational signals

## Questions and signals

| Question | Signal | First action |
|---|---|---|
| Is the public app usable? | Scheduled Production health workflow: homepage, DB readiness, auth configuration, sellable trips; three attempts before failing. | Open the failed step and check the bounded error code, then verify normal HTTPS in a browser. |
| Where did request latency go? | X-Request-Id links web/API JSON events. Server-Timing exposes wall-clock web/API/binding/session/email/command/tripLock durations. | Find request_completed and dependency_completed for that UUID in Workers Logs. Compare route/status distributions and p95/p99 in query results. |
| Are OTP requests failing? | email dependency_completed ok=false and auth route failure rates. | Inspect Resend delivery/errors for the user's reported time. Never paste codes or recipient data into logs. Provider acceptance is not inbox delivery. |
| Are resources exhausted? | Cloudflare Workers Metrics: errors/outcomes (including exceededCpu), CPU and wall time by Worker. | Check web and API separately; correlate with request failures. No paid plan is enabled automatically. |

## Privacy and interpretation

All public requests receive a server-generated UUID. The private API accepts the web-generated UUID only in UUID format. Application event fields use bounded route templates and omit query strings, identity, resource IDs, headers, bodies, OTPs and provider responses. Unknown routes become `other`. Start server functions use a bounded route template. Idle-pool failures retain the creating request/job UUID. `binding` measures the web-to-API call, while `api` identifies API Worker handling time. Timing numbers are wall clock, not CPU time. The web request span ends when response headers are ready, not after every streamed byte; parallel dependency totals can exceed request wall time. Do not add them together as a critical path.

Cloudflare separately enriches custom events with request URL/path metadata. Disabling invocation logs alone did not remove OAuth query parameters from that enrichment. Both Worker configurations now explicitly set `observability.redact_query_string=true`, and the release guard refuses configurations that omit it or re-enable invocation logs. This native setting removes queries from platform logs/traces while preserving errors and correlation. Request paths can still contain opaque resource IDs in provider metadata; account access/retention controls apply. Never publish raw provider records. [Cloudflare observability redaction setting](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/).

The gap was confirmed using a boolean-only inspection of historical callback records; no code/state was printed, exported or committed. Historical events remain subject to provider retention. A fresh real Google callback at 12:14 UTC passed after deployment: both the web and API records contained a callback URL with no query string, and neither contained code/state parameters. [Boolean-only evidence](evidence/p0-2026-10-26/native-url-redaction.json).

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

The 26 October drill passed: intentional failure [40314860795](https://github.com/jackedengineer/quickbus/actions/runs/40314860795), then normal success [40315346714](https://github.com/jackedengineer/quickbus/actions/runs/40315346714). The failed run is an intentional notification-path exercise, not an app outage.

## Native error monitor and job health

Cloudflare **KwikBus application errors** (`98f43b5fff404d618cb30f4d97c0119b`) is enabled, scoped to `kwikbus` and `kwikbus-api`, threshold >=1, ten-minute execution/average window, one-hour repeat. It sends only to the existing account owner. Its built-in Test action was confirmed; inbox delivery is not certified. The account-scoped saved predicate is:

```sql
SELECT COUNT(*) AS value
FROM logs.workersLogs
WHERE scriptName IN ('kwikbus', 'kwikbus-api')
  AND (level = 'error' OR (error IS NOT NULL AND error <> ''))
```

This covers application error logs and platform errors, including resource exceptions. Invocation URL logging remains disabled to protect OAuth callback parameters. Native metrics still expose outcomes/CPU. In the Logs UI, use `$metadata.error` / `$metadata.level` and `$workers.scriptName`; account SQL uses the dataset column aliases above. Structured application request IDs are the top-level `requestId`, distinct from Cloudflare's own `$metadata.requestId`.

Production observations include a handled idle database connection error whose correlated session/read requests completed HTTP 200, and one missing scheduled handler while deliberately running the old Worker version during the rollback drill. Do not suppress these logs or confuse a successful HTTP response with proof that an underlying connection never failed. Escalate repeated socket errors with correlation/time/version data, and inspect Neon availability before making connection/security changes.

`/api/health/maintenance` returns 503 when expiry has no successful pass in ten minutes, inventory has no success in three hours, any active service lacks an open departure beyond 27 days, or a HELD row is overdue by more than five minutes. Expiry runs every minute; inventory at minute 17 UTC each hour. Startup priming performs real work while Cron configuration propagates; observe later heartbeats rather than writing a fake success. Cron changes can take up to 15 minutes to propagate. A bounded expiry sweep handles ten trips; renewal inserts at most five complete departures. Monitor backlog/horizon before increasing those bounds.

No offsite backup service, field latency SLO, paid Cloudflare plan or automatic provider reconciliation is implied by this baseline. See [P0 evidence](p0-hardening.md), [performance](p0-performance.md) and [recovery](recovery.md).

## Official references

- [Workers observability](https://developers.cloudflare.com/workers/observability/)
- [Workers CPU and invocation limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers error fields and outcomes](https://developers.cloudflare.com/workers/observability/errors/)
- [Cron configuration propagation](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Scheduled workflow limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## Payment recovery — test checkout

The minute cron runs bounded payment jobs after expiry. A request wakeup targets
only its trusted checkout/inbox UUID; it cannot spend its budget on older jobs.
The durable queue claims up to six jobs per scheduled pass, with 45-second fenced
leases, SKIP LOCKED and bounded error backoff. This is a measured portfolio
baseline, not unlimited throughput. Observe queue age before increasing bounds.

Maintenance health now also requires a payment success heartbeat within ten
minutes when provider recovery is configured, no failed jobs/open cases and oldest
queued work less than 180 seconds overdue. Admission can be disabled without
stopping recovery. The same external health workflow and native error monitor
cover these signals. Unknown refunds/orders are deliberately visible failures.

- `ORDER_AMBIGUOUS`: compare the stored UUID receipt, key/environment, exact order
  matches and every associated payment using provider reads. Empty lookup never
  authorizes another create. Do not erase a case to make health green.
- `REFUND_UNCERTAIN` / `REFUND_FAILED`: inspect the stored payment, immutable refund
  UUID/full amount and provider refund list. Automatic recovery reads after an
  uncertain submission. Do not change the key, issue a partial replacement or
  assume a zero-result lookup proves no refund was accepted.
- `MONEY_MISMATCH` / `ALLOCATION_MISMATCH`: preserve evidence; compare frozen quote,
  provider IDs/currency, booking state and allocations. No review path may steal a
  seat from a new owner. An external refund of a fulfilled booking opens a case;
  paid cancellation is a later customer capability.
- `RETRY_EXHAUSTED`: inspect bounded failure codes and the current provider state
  before explicitly requeuing the existing resource. There is no public admin API.

Set the production admission flag false in a reviewed deployment to stop new
checkout; retain all three provider credentials and the webhook for recovery.
Never bulk-upload `.env.production`: it contains the migration owner credential.
An older API that predates payment states is not a compatible rollback once
PAYMENT_PENDING or CONFIRMED rows exist. Roll back to a compatible payment-aware
Worker, or disable admission and forward-fix while recovery continues.

Live money, continuous offsite backups, automatic manual-case resolution and
customer paid cancellation are not enabled by this test checkout release.

## Cancel a future trip (trusted operator, no admin UI)

Use the restricted runtime environment, never a customer-supplied command. First
read status and verify the exact trip/date and active booking count:

```sh
node --env-file=.env.production --import tsx scripts/cancel-trip.ts --trip <UUID>
```

After reviewing the audience, stop sales and enqueue the durable drain:

```sh
node --env-file=.env.production --import tsx scripts/cancel-trip.ts --trip <UUID> --execute --confirm-database kwikbus_v0 --actor <operator-slug> --reason OPERATOR_CANCELLED --max-affected <reviewed-count>
```

Reasons are OPERATOR_CANCELLED, SCHEDULE_CORRECTION and DEMO_RECOVERY. The command
rejects departed trips or a larger audience under the trip lock; rerunning the
same trip cannot duplicate work. There is no undo command. The minute worker
cancels at most three bookings per transaction and creates full refund intents
for confirmed fares. Read status again until remaining_bookings is zero and the
job is DONE. outstanding_refunds is a separate bank-recovery count; drain complete
does not mean those refunds have completed. Failed jobs/notification delivery
remain visible in readiness/backlog monitoring. Investigate before any deliberate
repair; never issue an extra provider refund to compensate for an unknown result.
For the isolated local development database use .env.lifecycle and confirm
quickbus; the command refuses production/local environment mismatches.
