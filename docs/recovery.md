# Database recovery drill

This runbook proves a portable consistent backup can be restored and audited. It does not restore over production, accept an arbitrary destination URL, establish continuous offsite backup or promise an RPO/RTO.

With Docker running, reviewed source and the ignored production environment configured:

```sh
node --import tsx scripts/recovery-drill.ts --production-drill
```

The source must be the direct `kwikbus_v0` connection with verified TLS. A read-only repeatable-read transaction exports a PostgreSQL snapshot; source schema/count/invariant audits and pg_dump use that same snapshot, so concurrent app activity cannot invalidate the comparison. A pinned PostgreSQL 18 client uses temporary mode-0600 service/password files rather than a credential-bearing command line.

The destination is always a newly named PostgreSQL container using tmpfs and `--network none`, with no published port. pg_restore uses that archive only. All table counts, column/default/constraint/index definitions and booking/allocation/quote/service-seat invariants must match. No customer row is printed or included in public evidence. The target is removed in finally; it is never promoted or attached to the public app.

On success the local archive is encrypted with AES-256-GCM, its plaintext copy removed, and temporary source credentials deleted. The archive and separate key file remain in a mode-0700 ignored local directory, with mode-0600 files. The key is on the same machine: this protects the stored archive from casual disclosure, not compromise/loss of the host. Arrange separate secure/offsite key and backup custody before claiming disaster resilience. On a failed drill, retain a private plaintext archive for diagnosis rather than deleting the only backup; never upload it or paste private tool logs.

Publish only the sanitised evidence JSON: snapshot/verification times, measured backup/restore/audit durations, schema digest, aggregate comparison counts, invariant outcomes and explicit limits. The snapshot age at verification is a measured potential recovery gap, not a recurring-backup RPO. Actual traffic after the snapshot is deliberately absent from the disposable target; production keeps serving it.

For a real recovery incident, isolate the failed service, choose a verified backup/PITR point, provision a separate managed target, reapply least-privilege roles/grants, validate auth secret/provider/canonical-origin configuration, audit invariants and perform browser acceptance before any deliberate cutover. Current migrations/grants live in version control. Once payments exist, reconcile provider observations before reopening sales. Those incident promotion steps are not claimed by this local drill.

[Neon pg_dump/restore guidance](https://neon.com/docs/manage/backup-pg-dump).
