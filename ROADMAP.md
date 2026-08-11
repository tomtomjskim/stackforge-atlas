# Roadmap

The roadmap is driven by real task evaluations, not document volume.

## Foundation — completed

- Established the engineering constitution and minimal agent rules.
- Defined the product-interface delivery loop.
- Treated wireframes as stateful screen contracts.
- Connected design-system decisions to implementation artifacts.
- Added synchronous interface guidance, schemas, a feature-slice kit, and a worked contract example.

## Cross-stack pilot — current

- [x] Add a runnable TypeScript / Node.js order-cancellation pilot.
- [x] Add a project-map schema, implementation manifest, and evaluation-case schema.
- [x] Verify contract-to-handler coverage, source-map references, and runnable tests in CI.
- [ ] Port the same contract to Python without copying Node-specific internals.
- [ ] Add modern and legacy PHP variants with explicit runtime constraints.
- [ ] Add PostgreSQL and MySQL persistence adapters for transaction, restart, and reconciliation evidence.
- [ ] Run controlled comparisons across model-only, minimal-harness, skill-loaded, and full-workflow modes.

## Operational engineering

- Add infrastructure, deployment, observability, security, and recovery packs.
- Add generated project-map facts and documentation-drift checks.
- Add migration, rollback, incident, and maintenance templates.
- Promote a pilot to operational evidence only after persistence and restart recovery are exercised.

## Evaluation and tooling

- Build repository-specific benchmark cases from repeated real failures.
- Record human correction, scope drift, regressions, duration, and execution cost separately.
- Introduce a CLI only after the schemas and templates survive more than one stack and one maintenance task.
