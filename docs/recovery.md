# Database recovery drill

This runbook proves a portable consistent backup can be restored and audited. It does not restore over production, accept an arbitrary destination URL, establish continuous offsite backup or promise an RPO/RTO.

With Docker running, reviewed source and the ignored production environment configured:

```sh
node --import tsx scripts/recovery-drill.ts --production-drill
```

The source must be the direct `kwikbus_v0` connection with verified TLS. A read-only repeatable-read transaction exports a PostgreSQL snapshot; source schema/count/invariant audits and pg_dump use that same snapshot, so concurrent app activity cannot invalidate the comparison. A pinned PostgreSQL 18 client uses temporary mode-0600 service/password files rather than a credential-bearing command line.

The minimal client image has no CA bundle. The tool supplies Node's bundled public trust roots explicitly and retains `sslmode=verify-full`; it runs pg_dump as the host user to keep the archive private and writable. Constraint definitions use PostgreSQL's canonical pretty rendering because dump/restore can flatten redundant AND parentheses. Object comparison ignores JSON key order while preserving arrays and all field values. No constraint or invariant is omitted. [PostgreSQL TLS verification](https://www.postgresql.org/docs/18/libpq-ssl.html).

The destination is always a newly named PostgreSQL container using tmpfs and `--network none`, with no published port. pg_restore uses that archive only. All table counts, column/default/constraint/index definitions and booking/allocation/quote/service-seat invariants must match. No customer row is printed or included in public evidence. The target is removed in finally; it is never promoted or attached to the public app.

On success the local archive is encrypted with AES-256-GCM, its plaintext copy removed, and temporary source credentials deleted. The archive and separate key file remain in a mode-0700 ignored local directory, with mode-0600 files. The key is on the same machine: this protects the stored archive from casual disclosure, not compromise/loss of the host. Arrange separate secure/offsite key and backup custody before claiming disaster resilience. On a failed drill, retain a private plaintext archive for diagnosis rather than deleting the only backup; never upload it or paste private tool logs.

Publish only the sanitised evidence JSON: snapshot/verification times, measured backup/restore/audit durations, schema digest, aggregate comparison counts, invariant outcomes and explicit limits. The snapshot age at verification is a measured potential recovery gap, not a recurring-backup RPO. Actual traffic after the snapshot is deliberately absent from the disposable target; production keeps serving it.

For a real recovery incident, isolate the failed service, choose a verified backup/PITR point, provision a separate managed target, reapply least-privilege roles/grants, validate auth secret/provider/canonical-origin configuration, audit invariants and perform browser acceptance before any deliberate cutover. Current migrations/grants live in version control. Once payments exist, reconcile provider observations before reopening sales. Those incident promotion steps are not claimed by this local drill.

[Neon pg_dump/restore guidance](https://neon.com/docs/manage/backup-pg-dump).

## Completed drill — 26 October 2026

The production snapshot at 11:22:58 UTC restored and passed its audit at 11:23:09 UTC. All 17 tables / 4,013 rows matched, including column/default/constraint/index definitions; all four booking/allocation/quote/service-seat invariant counts were zero. Backup took 8,825 ms, target startup/restore/audit 1,715 ms and total execution 11,690 ms. The snapshot was 10,913 ms old at verification. These are observed local drill timings, not service guarantees. [Sanitised evidence](evidence/p0-2026-10-26/recovery.json).

The initial attempts exposed the missing client CA bundle and representational schema/JSON differences; these were fixed and the entire live-source drill rerun successfully. The disposable target was removed, the successful archive encrypted and earlier failed plaintext copies removed after the successful backup existed. Source credentials were removed in every attempt. Production stayed online and was never a restore destination.


## Financial-schema drill — 27 October 2026

A fresh production snapshot at 09:09:32.350 UTC restored and passed its audit at
09:09:48.384 UTC after actual test captures and refunds. All 33 tables / 7,613 rows
and schema definitions matched; all 17 inventory, quote, fulfillment, payment,
refund and recovery-link invariant counts were zero. Backup took 11,099 ms,
restore/audit 4,351 ms and total execution 16,833 ms. Snapshot age was 16,035 ms.
The disposable target had no network and was removed; the successful archive was
encrypted and plaintext/source credentials removed. No production data was
replaced. These local timings do not establish continuous backup, RPO or RTO.
[Sanitized financial-schema evidence](evidence/payments-2026-10-27/recovery.json).

## Lifecycle-schema drill — 29 October 2026

The production snapshot at17:24:15.698UTC, after actual paid customer cancellation,
restored and passed its independent audit at17:24:37.880UTC. All36 tables /8,171
rows and schema definitions matched; all24 financial, inventory and lifecycle
invariants were zero. Backup took15,544ms, restore/audit6,026ms and total22,917ms;
snapshot age was22,183ms. The target had no external network or published port,
was removed afterward, and the successful archive was encrypted.

The first attempt caught a target-startup race: the image's temporary Unix-socket
server passed pg_isready before the requested database existed. Readiness now
queries the actual restore database over container loopback TCP, which the
initialization server does not expose. Production remained read-only throughout;
no database or customer record was replaced. The full retry passed using the
updated probe. These timings are one local recovery drill, not an RPO/RTO service
commitment. [Sanitized result](evidence/lifecycle-2026-10-29/recovery.json).
