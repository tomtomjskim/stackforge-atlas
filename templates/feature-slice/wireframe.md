# Wireframe — Feature Name

Use stable region, field, action, and message identifiers that also appear in `screen-contract.yaml` and the traceability matrix.

## Wide structure

```text
┌──────────────────────────────────────────────────────────────────────┐
│ [REGION page-header]                                                 │
│ [HEADING feature-heading]                         [ACTION close]     │
├─────────────────────────────────┬────────────────────────────────────┤
│ [REGION summary]                │ [REGION action-form]               │
│                                 │                                    │
│ Identity                        │ [FIELD reason-code]                │
│ Current state                   │ [FIELD reason-detail]              │
│ Eligibility or consequences     │                                    │
│                                 │ [ACTION submit-feature]            │
├─────────────────────────────────┴────────────────────────────────────┤
│ [REGION feedback]                                                   │
│ [MESSAGE validation-summary | pending | result | recovery]          │
└──────────────────────────────────────────────────────────────────────┘
```

## Narrow structure

```text
┌──────────────────────────────┐
│ [REGION page-header]         │
├──────────────────────────────┤
│ [REGION summary]             │
├──────────────────────────────┤
│ [REGION action-form]         │
│ [FIELD reason-code]          │
│ [FIELD reason-detail]        │
│ [ACTION submit-feature]      │
├──────────────────────────────┤
│ [REGION feedback]            │
└──────────────────────────────┘
```

## Stateful variants

| State | Structural change | Action behavior | Focus or announcement |
|---|---|---|---|
| Loading | Preserve region height; replace content with structural placeholders | Submit unavailable | Page heading remains focus target |
| Validation error | Keep input; reveal summary and field errors | Submit available after correction | Focus validation summary |
| Conflict | Replace form with refreshed eligibility explanation when action is no longer safe | Offer refresh or next valid action | Announce changed state |
| Pending | Replace form action with durable receipt and status | Repeated request resolves to same receipt | Announce accepted processing |
| Success | Show confirmed state and relevant consequence summary | Expose next task | Focus result heading |

## Annotation notes

- Identify content priority and responsive order, not pixel-perfect styling.
- Link every action to an `operationId` or local navigation outcome.
- Mark data that may be partial, stale, delayed, or permission-gated.
- Record any proposed new component or token in the design-system decision.
