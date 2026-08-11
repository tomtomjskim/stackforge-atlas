# Roadmap

The roadmap is driven by real task evaluations, not document volume.

## Foundation — completed

- Established the engineering constitution and minimal agent rules.
- Defined the product-interface delivery loop.
- Treated wireframes as stateful screen contracts.
- Connected design-system decisions to implementation artifacts.
- Added synchronous interface guidance, schemas, a feature-slice kit, and a worked contract example.

## Cross-stack and durability pilots — current

- [x] Add a runnable TypeScript / Node.js order-cancellation pilot.
- [x] Add a project-map schema, implementation manifest, and evaluation-case schema.
- [x] Verify contract-to-handler coverage, source-map references, and runnable tests in CI.
- [x] Add a PostgreSQL persistence pilot for transaction, idempotency, outbox, audit, worker lease, failed-attempt retry, and application-instance recovery evidence.
- [x] Add a data-store profile schema and PostgreSQL pilot profile.
- [ ] Exercise PostgreSQL process restart, migration rollback, backup/restore, PITR, and recovery-time evidence.
- [ ] Add a MySQL pilot that preserves the same outcomes using engine-native locking and worker patterns.
- [ ] Port the shared contract to Python without copying Node-specific internals.
- [ ] Add modern and legacy PHP variants with explicit runtime constraints.
- [ ] Run controlled comparisons across model-only, minimal-harness, skill-loaded, and full-workflow modes.

## Operational engineering

- Add infrastructure, deployment, observability, security, and recovery packs.
- Add generated project-map facts and documentation-drift checks.
- Add migration, rollback, incident, and maintenance templates.
- Promote a database pilot to Operational only after restart, backup/restore, monitoring, and rollback are exercised.

## Evaluation and tooling

- Build repository-specific benchmark cases from repeated real failures.
- Record human correction, scope drift, regressions, duration, and execution cost separately.
- Introduce a CLI only after the schemas and templates survive more than one language, data store, and maintenance task.
