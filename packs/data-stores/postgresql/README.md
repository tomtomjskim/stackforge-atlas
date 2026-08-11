# PostgreSQL Profile

This profile records PostgreSQL-specific guidance only after the repository has executable evidence. It does not make PostgreSQL the automatic default for every web application.

## Current evidence baseline

```text
PostgreSQL 18.4
Node.js 24
Read Committed
row and advisory locks
transactional Outbox
SKIP LOCKED worker lease
unknown-outcome reconciliation
append-only audit evidence
SIGQUIT recovery on persistent storage
retained-data forward migration
guarded down migration
custom-format backup and independent restore
```

The reference implementation is the [order-cancellation PostgreSQL pilot](../../../pilots/order-cancellation-postgres/README.md). Its [operational manifest](../../../pilots/order-cancellation-postgres/operational/manifest.yaml) and [runbook](../../../pilots/order-cancellation-postgres/operational/runbook.md) state exactly what the drill does and does not prove.

## Evidence now available

- local transaction and rollback behavior against PostgreSQL;
- concurrent command and worker claims;
- application-instance and PostgreSQL-process replacement with intact persistent storage;
- unknown-provider quarantine and explicit operator resolution;
- migration 002 applied over retained migration 001 data;
- guarded down migration in an isolated pre-002 restore;
- `pg_dump` custom archive restored into an independent PostgreSQL volume;
- compared business, migration, audit, and reconciliation evidence;
- observed restart and restore timing captured as drill evidence.

## Still separate gates

- storage or host loss;
- corruption recovery;
- continuous WAL archiving and point-in-time recovery;
- replication and automated failover;
- production backup encryption and retention;
- production RPO/RTO objectives;
- real provider status reconciliation;
- sustained contention, vacuum, and pool-capacity tests.

## What belongs in this profile

- transaction and isolation behavior that changes implementation decisions;
- constraints and indexes that enforce domain invariants;
- concurrency, retry, lease, and reconciliation requirements;
- migration, rollback, backup, restore, and recovery procedures;
- PostgreSQL-specific operational failure modes;
- executable evidence that demonstrates each claim.

## What does not belong here

- generic SQL explanations already covered by the engineering core;
- popularity rankings presented as architecture decisions;
- unverified tuning values;
- claims that `SKIP LOCKED`, serializable isolation, partitioning, or JSONB are universal defaults;
- a full Operational claim based on one single-node recovery drill.

The profile remains `pilot` until WAL/PITR, storage-loss, replication/failover, production security, and realistic operational-load evidence are added.
