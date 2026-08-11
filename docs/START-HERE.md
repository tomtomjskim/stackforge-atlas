# Start Here

StackForge Atlas is easiest to understand as a delivery loop rather than a document library.

## Choose your starting point

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

1. Select a user-visible flow with known friction or recurring defects.
2. Capture current behavior, including error and permission states.
3. Identify duplicated tokens, components, validation rules, and API shapes.
4. Define the intended screen and backend contracts.
5. Migrate one slice and measure the effect before generalizing a rule.

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

## Repository map

| Area | Purpose |
|---|---|
| `core/` | Stable, stack-independent engineering guidance |
| `templates/` | Copyable feature and review artifacts |
| `schemas/` | Machine-verifiable contracts for structured artifacts |
| `examples/` | Filled examples that prove the workflow end to end |
| `scripts/` | Validation and future generation tools |
| `assets/` | Brand and explanatory visuals |

## Validate the repository

```bash
python -m pip install -r requirements-dev.txt
python scripts/validate_atlas.py
```

CI runs the same validator. Passing validation proves that structured artifacts are syntactically and schematically coherent; it does not prove product quality, security, or usability. Those require the review and test evidence defined by each task.
