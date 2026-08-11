# Cross-stack Pilots

Cross-stack pilots test whether Atlas contracts survive implementation in different languages, data stores, and operational shapes. They are not syntax translations and they do not rank technologies by popularity.

## Pilot protocol

Each pilot must provide:

1. a shared product, screen, and interface contract;
2. a runnable implementation or adapter;
3. a project map describing boundaries and limitations;
4. an implementation manifest mapping operations to handlers and evidence;
5. an evaluation case with stable acceptance scenarios;
6. stack-native type, test, and verification commands;
7. an adversarial statement of what the pilot does not prove.

A persistence pilot also provides a durability manifest covering migrations, transaction boundaries, Outbox delivery, recovery, audit behavior, and explicit limitations.

An operational-recovery pilot adds:

- an executable destructive drill isolated from development data;
- a machine-readable manifest and generated report;
- recovery-point and recovery-time assertions;
- retained-data migration and rollback evidence;
- backup and restore comparison;
- observable unresolved work and an operator resolution path;
- a runbook and alert conditions;
- a precise statement of which failure domain was not exercised.

## Comparison rule

The same scenario should be compared without forcing identical internal architecture.

```text
Keep constant
- user outcome
- operation IDs and transport semantics
- domain invariants
- security boundary
- failure and recovery expectations
- evaluation scenarios

Allow to vary
- framework
- module organization
- transaction and locking strategy
- data-store constraints
- worker claim strategy
- backup and recovery mechanism
- test tools
- runtime lifecycle
- deployment packaging
```

## Evidence levels

| Level | Meaning |
|---|---|
| Contract | Structured artifacts agree and references resolve. |
| Runnable | The implementation starts and exposes the declared boundary. |
| Verified | Automated tests exercise domain and interface behavior. |
| Durable | Accepted state and unfinished work survive application-instance replacement. |
| Operational-recovery subset | A named database failure and restore procedure are executed with measured evidence and explicit failure-domain limits. |
| Operational | Production-relevant restart, backup/restore, deployment, monitoring, rollback, and required failure domains are exercised. |
| Comparative | Repeated runs across harness modes or stacks produce measured results. |

A pilot must not claim a higher level because a lower-level validator passed. Durable does not imply Operational, logical restore does not imply PITR, and transactional Outbox does not imply exactly-once external delivery.

## Current sequence

1. TypeScript / Node.js greenfield runnable pilot — completed
2. PostgreSQL transaction and durability pilot — completed at the Durable subset
3. PostgreSQL retained-volume restart, forward migration, guarded rollback, logical restore, and operator reconciliation — completed at an Operational-recovery subset
4. PostgreSQL WAL archive and point-in-time recovery drill
5. MySQL pilot preserving outcomes with engine-native implementation and recovery evidence
6. Python port of the shared contract
7. PHP modern and legacy runtime variants
8. Existing-codebase maintenance task using the same evaluation case
9. Controlled harness-mode comparisons

Rules should be promoted into `core/` only after a failure repeats across more than one stack, data store, or project shape.
