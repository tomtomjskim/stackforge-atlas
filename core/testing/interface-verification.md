# Interface Verification

## Principle

Verification should prove that the product-interface chain holds under realistic success, failure, permission, concurrency, and accessibility conditions. Test volume is not the goal; coverage of meaningful risk is.

## Evidence layers

### 1. Static contract validation

- JSON and YAML parse successfully.
- Structured artifacts match their schemas.
- OpenAPI or AsyncAPI documents lint successfully.
- Generated clients or types compile where used.
- Design tokens resolve without cycles or missing aliases.

### 2. Component and pattern tests

- variants and states render as contracted;
- keyboard and pointer interactions work;
- focus enters, moves, and returns correctly;
- async controls prevent unsafe duplicate actions;
- errors and status messages are programmatically associated;
- localization, long content, and constrained width do not destroy meaning.

### 3. Consumer-contract tests

Verify that the backend implementation produces the status codes, schemas, headers, error codes, idempotency behavior, and compatibility promised to clients.

### 4. Integration tests

Exercise domain rules, persistence, authorization, external adapters, retries, outbox or job behavior, and transaction boundaries with realistic infrastructure where risk warrants it.

### 5. End-to-end tests

Cover a small number of critical user journeys and recovery paths. Do not use E2E tests to compensate for absent lower-level contracts.

### 6. Visual-regression evidence

Use for stable component states and critical layouts. A visual snapshot cannot prove semantics, keyboard behavior, authorization, data correctness, or safe failure.

### 7. Operational verification

For high-risk changes, include migration rehearsal, rollback, smoke checks, logs and metrics, alert behavior, backup or reconciliation needs, and post-deploy observation.

## Risk-based minimums

| Change | Minimum evidence |
|---|---|
| Copy or reversible styling | visual review, relevant component check |
| Component behavior | unit/interaction, accessibility, representative visual states |
| New screen or flow | screen-state tests, contract test, integration, critical E2E |
| API behavior | schema lint, contract test, authorization, compatibility |
| Money, inventory, identity, permissions | negative tests, concurrency, idempotency, audit, reconciliation, rollback |
| Migration or irreversible operation | rehearsal, backup/restore assumption, rollback or forward-fix plan |

## Evidence report

A completion report should state:

- exact commands and test suites executed;
- results and relevant artifacts;
- failures repaired during the loop;
- checks not executed and why;
- environment differences from production;
- residual risk and monitoring required after release.

"Tests pass" without naming the tests is insufficient evidence.
