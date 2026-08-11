# PostgreSQL Order-Cancellation Recovery Runbook

## Purpose

Restore a known-safe service state without converting an unknown payment-provider result into a false success or false failure.

This runbook applies to the StackForge Atlas pilot only. Production use requires environment-specific ownership, credentials, backup tooling, replication topology, and approval controls.

## First response

1. Stop or drain application writes when database state, migration state, or provider outcome is uncertain.
2. Preserve PostgreSQL logs, application request identifiers, Outbox rows, cancellation IDs, and provider references.
3. Identify the failure class before changing state:
   - application process failure;
   - PostgreSQL process failure with intact storage;
   - storage or host loss;
   - migration failure;
   - backup restore;
   - external provider outcome unknown.
4. Do not clear `cancellation_id`, change `REFUND_PENDING`, or retry with a new business identity while provider outcome is unknown.

## PostgreSQL process restart with intact storage

1. Confirm the data volume is the same volume used before shutdown.
2. Start PostgreSQL and wait for `pg_isready` plus a successful SQL query.
3. Inspect logs for crash-recovery or clean-shutdown evidence.
4. Compare committed markers:
   - order and cancellation counts;
   - pending cancellation IDs;
   - Outbox event IDs and attempt state;
   - audit event IDs;
   - applied migration versions.
5. Resume workers before accepting new commands only when migrations and invariants match the release.
6. Watch `operational_recovery_health` for pending age, ready Outbox work, expired leases, and open reconciliation cases.

The automated drill uses PostgreSQL immediate shutdown (`SIGQUIT`) because it intentionally requires recovery on the next start. It does not use `SIGKILL` as the normal test mechanism.

## Migration failure

### Before migration-specific data exists

1. Restore or clone the pre-migration backup into an isolated database.
2. Apply the forward migration.
3. Run contract and data-integrity checks.
4. Run the down migration only if its guard allows it.
5. Compare retained business data and `schema_migrations` with the pre-migration state.

### After migration-specific data exists

Do not force the down migration. Migration `002_reconciliation_cases` rejects rollback when reconciliation rows exist. Create a forward repair migration instead so operator decisions and audit evidence are not discarded.

## Logical backup restore

1. Create a custom-format backup with `pg_dump --format=custom`.
2. Record the backup checksum, source migration set, and source snapshot.
3. Restore with `pg_restore --exit-on-error` into an independent database or volume.
4. Verify migration versions and domain counts before application traffic.
5. Verify at least one representative state transition, Outbox row, audit event, and reconciliation record.
6. Record observed backup and restore duration as evidence, not as a production RTO commitment.

## Unknown provider outcome

An exhausted transport retry is not proof that cancellation failed.

1. Confirm the cancellation remains `PENDING` and the order remains `REFUND_PENDING`.
2. Confirm the Outbox row has `reconciliation_required_at` and is excluded from ordinary worker claims.
3. List the open `reconciliation_cases` row.
4. Query the provider through an authoritative status interface using the stable cancellation/provider identity.
5. Resolve exactly one outcome:
   - `COMPLETED`: finalize refund state and keep the order protected;
   - `FAILED`: preserve the failed operation and release the order for a new versioned attempt.
6. Record operator, provider reference, note, trace ID, and append-only audit evidence.
7. Recheck `operational_recovery_health` until the open case count returns to zero.

Pilot commands (from the repository root):

```bash
cd pilots/order-cancellation-postgres/app
npm run ops -- list-reconciliation
npm run ops -- health
npm run ops -- resolve-reconciliation \
  --case 1 \
  --resolution completed \
  --actor operator-1 \
  --provider-reference provider-reference-123 \
  --note "Authoritative provider lookup confirmed completion."
```

## Escalation conditions

Escalate without automated state mutation when:

- the provider returns contradictory status for the same identity;
- the same order has more than one effective cancellation;
- audit evidence is missing or mutable;
- restored migration history differs from the release;
- backup checksum or source identity is unknown;
- crash recovery reports corruption or PostgreSQL cannot reach consistency;
- reconciliation remains open beyond the agreed operational threshold.

## Completion evidence

A recovery is complete only when:

- database health and migration versions match the release;
- committed domain and audit state is accounted for;
- Outbox work is completed, retryable, or explicitly quarantined;
- every quarantined provider outcome has an assigned owner;
- the application can serve health and contract checks;
- rollback or roll-forward decision and observed timings are recorded.
