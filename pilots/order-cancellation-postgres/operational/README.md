# PostgreSQL Operational Recovery Drill

This drill moves the order-cancellation PostgreSQL pilot beyond application-instance durability and into a bounded operational-recovery exercise.

It deliberately separates what is executed from what remains a production responsibility.

## What the drill executes

```text
001 database with committed pending work
    ↓
PostgreSQL immediate shutdown (SIGQUIT)
    ↓
Same persistent data volume restarted
    ↓
Committed state compared before and after WAL recovery
    ↓
002 forward migration over retained data
    ↓
Pending Outbox work completed
    ↓
Unknown provider outcome quarantined
    ↓
Operator reconciliation resolves authoritative result
    ↓
Custom-format logical backup
    ↓
Restore into an independent PostgreSQL volume
    ↓
Business, migration, and reconciliation evidence compared
```

The migration drill also restores a pre-002 backup into an isolated database, applies migration 002, then executes its guarded down migration before any 002-specific rows exist.

## Run locally

Requirements:

- Docker with the `postgres:18.4` image available;
- Node.js 24;
- the PostgreSQL pilot dependencies installed from its committed lockfile;
- free local ports `56432` and `56433`, or overrides through `PRIMARY_PORT` and `RESTORE_PORT`.

```bash
cd pilots/order-cancellation-postgres/app
npm ci --ignore-scripts --no-audit --no-fund
cd ../../..

bash pilots/order-cancellation-postgres/operational/run-recovery-drill.sh
```

The generated evidence defaults to `/tmp/stackforge-atlas-postgres-recovery`. Set `OPERATIONAL_EVIDENCE_DIR` to retain it elsewhere.

## Evidence produced

- snapshots before and after immediate restart;
- PostgreSQL crash-recovery logs;
- pre-002 and final custom-format backups;
- forward-migration and guarded-rollback checks;
- reconciliation-open and reconciliation-resolved records;
- health snapshots before and after operator action;
- independent restore snapshot;
- `operational-recovery-report.json` with observed timings and scope limitations.

## Claim boundary

Passing this drill supports an **operational-recovery subset** claim. It does not prove:

- host or storage loss recovery;
- continuous WAL archiving or point-in-time recovery;
- replication or automated failover;
- production RPO/RTO objectives;
- real payment-provider idempotency and status lookup;
- production authentication or authorization for operator actions.

Read the [runbook](./runbook.md), [manifest](./manifest.yaml), and [alert catalog](./alerts.yaml) before adapting the drill.
