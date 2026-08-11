# Start Here

StackForge Atlas is easiest to understand as a delivery and recovery loop rather than a document library.

## Choose your starting point

### You want to see database recovery evidence

Start with the [PostgreSQL operational recovery drill](../pilots/order-cancellation-postgres/operational/README.md). It terminates and restarts PostgreSQL on retained storage, compares committed records, applies a forward migration, exercises guarded rollback on restored data, restores logical backups into separate databases, and resolves a quarantined external outcome through an explicit operator command.

```bash
cd pilots/order-cancellation-postgres/app
npm ci --ignore-scripts --no-audit --no-fund
cd ..
bash operational/run-recovery-drill.sh
```

The generated report records elapsed time and data comparisons. It is a single-host, logical-backup recovery subset—not point-in-time recovery, replication, failover, or proof of recovery after losing the original volume.

### You want to see persistence and transaction evidence

Start with the [PostgreSQL durability pilot](../pilots/order-cancellation-postgres/README.md). It keeps the existing browser and OpenAPI contract while moving authoritative state, idempotency, Outbox work, audit evidence, and worker recovery into PostgreSQL.

```bash
cd pilots/order-cancellation-postgres
docker compose up
```

### You want to see the contracts become software

Start with the [Node.js order-cancellation pilot](../pilots/order-cancellation-node/README.md). It connects the feature and screen contracts to a runnable browser surface, HTTP operations, domain invariants, tests, a project map, and an evaluation case.

```bash
cd pilots/order-cancellation-node/app
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm start
```

### A new feature is still vague

1. Copy `templates/feature-slice/` into the target project or a working folder.
2. Complete `feature.yaml` and `user-flow.md` before choosing implementation details.
3. Define one `screen-contract.yaml` per meaningful surface.
4. Record design-system additions or reuse decisions.
5. Write the OpenAPI or AsyncAPI contract required by the surface.
6. Complete the traceability matrix and implementation plan.
7. Build, test, review adversarially, and attach evidence.

Read:

- [Product-interface delivery](../core/experience/product-interface-delivery.md)
- [Wireframes and screen contracts](../core/experience/wireframes-and-screen-contracts.md)
- [Backend interface design](../core/interfaces/backend-interface-design.md)

### An existing application is inconsistent

Start by mapping one vertical feature slice rather than redesigning the whole system.

1. Copy the [project-map template](../templates/project-map/project-map.yaml).
2. Select a user-visible flow with known friction or recurring defects.
3. Capture current behavior, including error and permission states.
4. Identify duplicated tokens, components, validation rules, and API shapes.
5. Define the intended screen and backend contracts.
6. Migrate one slice and measure the effect before generalizing a rule.

Read:

- [Design-system guidance](../core/experience/design-system.md)
- [UI-backend traceability](../core/interfaces/ui-backend-traceability.md)
- [Adversarial experience review](../core/review/adversarial-experience-review.md)

### An agent is implementing a scoped task

Provide the agent with:

- the task goal and explicit non-goals;
- acceptance criteria and risk classification;
- the relevant feature slice and project-map excerpt;
- real build, test, lint, migration, recovery, and validation commands;
- compatibility, rollback, and operator constraints.

Do not preload every Atlas document. The root `AGENTS.md` is the always-on baseline; detailed guides and runbooks are task-specific context.

### You are comparing stacks, data stores, or harness modes

Use the [cross-stack pilot protocol](./CROSS-STACK-PILOTS.md), the [evaluation template](../templates/evaluation/eval-case.yaml), and the [data-store profile template](../templates/data-store/profile.yaml). Keep product outcomes, operation IDs, domain invariants, and recovery expectations constant while allowing implementation-native decisions to differ.

## Repository map

| Area | Purpose |
|---|---|
| `core/` | Stable, stack-independent engineering guidance |
| `templates/` | Copyable feature, project-map, evaluation, profile, and operations artifacts |
| `schemas/` | Machine-verifiable contracts for structured artifacts |
| `examples/` | Filled design and contract examples |
| `pilots/` | Runnable, durability, and operational-recovery implementations with evidence |
| `packs/` | Language and data-store guidance grounded in pilot evidence |
| `scripts/` | Cross-artifact validation, report validation, and regression checks |
| `assets/` | Brand and explanatory visuals |

## Validate the repository

```bash
python -m pip install -r requirements-dev.txt
python scripts/validate_atlas.py
python scripts/validate_pilots.py
python scripts/validate_durability_pilots.py
python scripts/validate_operational_recovery.py
python scripts/test_validate_pilot_regressions.py
python scripts/test_validate_durability_regressions.py
python scripts/test_validate_operational_recovery_regressions.py

cd pilots/order-cancellation-node/app
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

The PostgreSQL jobs additionally provision real PostgreSQL 18 containers. The operational job executes the destructive restart and restore drill in isolated containers and validates its generated report.

Passing these checks proves only the declared contracts and scenarios. It does not prove production security, usability, host-loss recovery, point-in-time recovery, or comparative model performance.
