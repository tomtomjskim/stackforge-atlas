# Implementation Plan — Feature Name

## Current behavior

Describe the existing flow, relevant modules, source data, and known defects. Cite inspected files or runtime evidence.

## Intended change

Describe the smallest coherent vertical slice that satisfies the contracts.

## Affected areas

- UI surfaces and components:
- Backend commands and queries:
- Data stores and migrations:
- Background jobs or external integrations:
- Observability and audit:
- Documentation and source map:

## Sequence

1. Contract and schema changes.
2. Domain behavior and persistence.
3. Interface implementation.
4. UI states and design-system integration.
5. Verification and adversarial review.
6. Rollout, observation, and documentation.

## Compatibility

- Public API compatibility:
- Existing data compatibility:
- Client/version assumptions:
- Feature flag or staged rollout:

## Verification

List exact commands, test suites, fixtures, and manual scenarios.

## Rollback and reconciliation

State whether rollback is safe, whether a forward fix is required, and how partially completed external effects will be reconciled.

## Stop conditions

- Acceptance criteria satisfied.
- Mandatory gates pass.
- No blocker finding remains.
- Residual risks have an owner and observation plan.
