# Design-System Decision — Feature Name

## Reuse inventory

| Need | Existing token/component/pattern | Decision | Evidence |
|---|---|---|---|
| Primary action | | Reuse / extend / replace | |
| Destructive action | | Reuse / extend / replace | |
| Form field | | Reuse / extend / replace | |
| Validation summary | | Reuse / extend / replace | |
| Pending result | | Reuse / extend / replace | |

## Proposed additions

For each addition, define the semantic need before appearance.

```yaml
id: component-or-token-id
kind: token | primitive | component | pattern
problem: Repeated product behavior the addition solves.
consumers:
  - Known surface or component
accessibility_requirement: Concrete behavior, not a generic compliance label.
compatibility: Additive, breaking, or migration-required.
exit_criteria: Evidence required before the addition becomes stable.
```

## Exceptions

Record one-off deviations, why reuse is unsafe or misleading, and when the exception should be removed.

## Adoption and deprecation

- Owner:
- Initial consumers:
- Usage search or inventory method:
- Migration notes:
- Deprecation target:
