# PostgreSQL Pilot — From Durable Command to Recovery Evidence

This pilot keeps the order-cancellation product, screen, and OpenAPI contracts fixed while changing the data and recovery boundary.

The first stage proved that accepted state lives outside one application process. The operational stage now exercises a PostgreSQL immediate restart on persistent storage, a retained-data migration, a guarded rollback boundary, logical backup and independent restore, and explicit operator resolution for unknown provider outcomes.

```text
customer command
    ↓
locked transactional acceptance
    ↓
order + cancellation + outbox + audit commit
    ↓
worker delivery
    ├─ explicit completion
    ├─ explicit rejection
    └─ unknown outcome → protected reconciliation case

persistent database
    ↓
SIGQUIT immediate shutdown
    ↓
WAL recovery on the same data volume
    ↓
forward migration + pending-work recovery
    ↓
logical backup + independent restore comparison
```

## What is verified

### Transaction and worker durability

- one `Read Committed` transaction protects eligibility and acceptance;
- actor-scoped idempotency is serialized and constrained in PostgreSQL;
- order state, cancellation operation, Outbox work, and audit evidence commit or roll back together;
- provider work occurs after commit;
- workers use `FOR UPDATE SKIP LOCKED` and an expiring lease;
- duplicate delivery converges through a stable provider identity;
- transport-ambiguous exhaustion stays `PENDING` and opens reconciliation instead of becoming a false failure.

### Operational recovery subset

- PostgreSQL receives `SIGQUIT`, stops without a normal checkpoint, and restarts on the same named volume;
- committed order, cancellation, Outbox, and audit markers are compared before and after recovery;
- migration `002_reconciliation_cases` applies over retained `001` data;
- its down migration is exercised on an isolated pre-002 restore and refuses rollback after reconciliation rows exist;
- a custom-format `pg_dump` restores into an independent PostgreSQL volume;
- primary and restored business, migration, and reconciliation counts are compared;
- an operator service and CLI can list and atomically resolve unknown provider outcomes;
- operational health exposes pending work, ready Outbox work, expired leases, open reconciliation cases, and oldest pending age.

## Run the application

```bash
cd pilots/order-cancellation-postgres
docker compose up
```

Open `http://127.0.0.1:3001` with the fixture:

```text
actor: customer-1
order: order-1001
```

## Run verification against PostgreSQL

```bash
export DATABASE_URL='postgresql://stackforge:stackforge@127.0.0.1:5432/stackforge'

cd pilots/order-cancellation-postgres/app
npm ci --ignore-scripts --no-audit --no-fund
npm run migrate
npm run seed
npm run check
```

## Run the operational recovery drill

```bash
cd pilots/order-cancellation-postgres/app
npm ci --ignore-scripts --no-audit --no-fund
cd ../../..

bash pilots/order-cancellation-postgres/operational/run-recovery-drill.sh
```

The drill writes an evidence bundle containing snapshots, crash-recovery logs, backup archives, reconciliation results, and `operational-recovery-report.json`.

## Operator reconciliation

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

An exhausted network retry is not enough to release the order. The case remains open until an authoritative provider result is recorded.

## Evidence map

1. [`project-map.yaml`](./project-map.yaml) describes ownership, modules, data, and recovery boundaries.
2. [`durability-manifest.yaml`](./durability-manifest.yaml) records transaction, Outbox, audit, and durability evidence.
3. [`operational/manifest.yaml`](./operational/manifest.yaml) records the recovery drill and its claim boundary.
4. [`operational/runbook.md`](./operational/runbook.md) describes response and reconciliation procedure.
5. [`operational/alerts.yaml`](./operational/alerts.yaml) defines the minimum actionable signals.
6. [`migrations/002_reconciliation_cases.sql`](./migrations/002_reconciliation_cases.sql) adds cases and operational health.
7. [`app/test/operational.test.ts`](./app/test/operational.test.ts) verifies the operator resolution transaction.

## Evidence boundary

Current level: **Operational recovery subset**.

Still not proven:

- host or storage loss, corruption, replication, or automated failover;
- continuous WAL archiving and point-in-time recovery;
- production RPO/RTO objectives;
- real payment-provider idempotency and status lookup;
- production operator authentication and authorization;
- encrypted backup storage and key management;
- sustained load, lock-contention limits, and connection-pool sizing;
- browser automation, accessibility, and visual regression.

The observed CI timings are evidence from one controlled drill, not production guarantees.
