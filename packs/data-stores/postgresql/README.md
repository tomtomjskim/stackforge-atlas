# PostgreSQL Profile

This profile records PostgreSQL-specific implementation guidance only after it has executable pilot evidence. It does not make PostgreSQL the automatic default for every web application.

## Current pilot baseline

```text
PostgreSQL 18.4
Node.js 24
node-postgres 8
Read Committed
row-level order lock
transactional outbox
SKIP LOCKED worker lease
append-only audit table
```

The reference implementation is the [order-cancellation durability pilot](../../../pilots/order-cancellation-postgres/README.md).

## What belongs in this profile

- transaction and isolation behavior that changes implementation decisions;
- constraints and indexes that enforce domain invariants;
- concurrency and retry requirements;
- migration, rollback, backup, and recovery procedures;
- outbox, lease, and CDC patterns;
- PostgreSQL-specific operational failure modes;
- evidence that demonstrates the guidance.

## What does not belong here

- generic SQL explanations already covered by the engineering core;
- popularity rankings presented as architecture decisions;
- unverified tuning values;
- claims that `SKIP LOCKED`, serializable isolation, partitioning, or JSONB are universal defaults;
- production recommendations copied from an in-memory or single-process test.

The profile remains `pilot` until database restart, backup/restore, migration, and operational monitoring evidence are added.
