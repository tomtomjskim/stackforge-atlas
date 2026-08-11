# Roadmap

The roadmap is driven by executable task and recovery evidence, not document volume.

## Foundation — completed

- Established the engineering constitution and minimal agent rules.
- Defined the product-interface delivery loop.
- Treated wireframes as stateful screen contracts.
- Connected design-system decisions to implementation artifacts.
- Added synchronous interface guidance, schemas, a feature-slice kit, and a worked contract example.

## Runnable and durable pilots — completed subset

- [x] Add a runnable TypeScript / Node.js order-cancellation pilot.
- [x] Add project-map, implementation-manifest, and evaluation-case schemas.
- [x] Verify contract-to-handler coverage, source-map references, and runnable tests in CI.
- [x] Add PostgreSQL transaction, idempotency, outbox, audit, worker-lease, and application-instance recovery evidence.
- [x] Add a data-store profile schema and PostgreSQL pilot profile.

## PostgreSQL operational recovery — current

- [x] Terminate and restart the PostgreSQL process while retaining its volume.
- [x] Verify committed pending operations, Outbox work, and audit evidence before and after restart.
- [x] Apply a forward migration against retained data.
- [x] Exercise a guarded down migration on a restored pre-migration backup.
- [x] Create and restore logical backups into separate databases and compare business counts.
- [x] Measure restart and logical-restore elapsed time against explicit pilot thresholds.
- [x] Add observable reconciliation cases, health signals, operator resolution commands, and a runbook.
- [ ] Configure WAL archiving and exercise point-in-time recovery to a target timestamp.
- [ ] Exercise loss of the original database volume or host rather than restarting the same retained volume.
- [ ] Add replication and controlled failover evidence.
- [ ] Exercise production-like migration rollback or roll-forward strategy on a larger retained dataset.

## Cross-engine and language expansion

- [ ] Add a MySQL pilot that preserves the same outcomes using engine-native locking, worker, and recovery patterns.
- [ ] Port the shared contract to Python without copying Node-specific internals.
- [ ] Add modern and legacy PHP variants with explicit runtime constraints.
- [ ] Compare greenfield and existing-codebase maintenance tasks.
- [ ] Run controlled comparisons across model-only, minimal-harness, skill-loaded, and full-workflow modes.

## Operational engineering

- Add deployment, observability, security, incident, and recovery packs grounded in repeatable drills.
- Add generated project-map facts and documentation-drift checks.
- Add broader migration, rollback, backup, incident, and maintenance templates.
- Promote a database profile to Operational only when its claimed restart, restore, monitoring, and rollback procedures are executable and current.

## Evaluation and tooling

- Build repository-specific benchmark cases from repeated real failures.
- Record human correction, scope drift, regressions, duration, recovery point, recovery time, and execution cost separately.
- Introduce a CLI only after the schemas and templates survive more than one language, data store, and maintenance task.
