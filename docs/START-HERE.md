# Start Here

StackForge Atlas is easiest to understand as a delivery loop rather than a document library.

## Choose your starting point

### You want to see persistence and recovery evidence

Start with the [PostgreSQL durability pilot](../pilots/order-cancellation-postgres/README.md). It keeps the existing browser and OpenAPI contract while moving authoritative state, idempotency, outbox work, audit evidence, and worker recovery into PostgreSQL.

```bash
cd pilots/order-cancellation-postgres
docker compose up
```

The pilot proves application-instance continuity and abandoned-worker recovery. It does not yet prove PostgreSQL server restart, backup restore, failover, or a real payment-provider contract.

### You want to see the contracts become software

Start with the [Node.js order-cancellation pilot](../pilots/order-cancellation-node/README.md). It connects the existing feature and screen contracts to a runnable browser surface, HTTP operations, domain invariants, tests, a project map, and an evaluation case.

```bash
cd pilots/order-cancellation-node/app
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm start
```

The pilot is a verification fixture, not a production deployment recommendation. Read its explicit limitations before copying an implementation choice.

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
- real build, test, lint, and validation commands;
- any compatibility and rollback constraints.

Do not preload every Atlas document. The root `AGENTS.md` is the always-on baseline; detailed guides are task-specific context.

### You are comparing stacks, data stores, or harness modes

Use the [cross-stack pilot protocol](./CROSS-STACK-PILOTS.md), the [evaluation template](../templates/evaluation/eval-case.yaml), and the [data-store profile template](../templates/data-store/profile.yaml). Keep product outcomes, operation IDs, domain invariants, and recovery expectations constant while allowing implementation-native decisions to differ.

## Repository map

| Area | Purpose |
|---|---|
| `core/` | Stable, stack-independent engineering guidance |
| `templates/` | Copyable feature, project-map, evaluation, and profile artifacts |
| `schemas/` | Machine-verifiable contracts for structured artifacts |
| `examples/` | Filled design and contract examples |
| `pilots/` | Runnable and durability implementations with evaluation evidence |
| `packs/` | Language and data-store guidance grounded in pilot evidence |
| `scripts/` | Cross-artifact validation and regression checks |
| `assets/` | Brand and explanatory visuals |

## Validate the repository

```bash
python -m pip install -r requirements-dev.txt
python scripts/validate_atlas.py
python scripts/validate_pilots.py
python scripts/validate_durability_pilots.py
python scripts/test_validate_pilot_regressions.py
python scripts/test_validate_durability_regressions.py

cd pilots/order-cancellation-node/app
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

The PostgreSQL pilot additionally requires a PostgreSQL 18 instance and its own `npm run migrate && npm run check` sequence. CI provisions that database.

Passing these checks proves that the checked contracts, references, and executable scenarios agree. It does not prove production security, usability, database operations, or comparative model performance.
