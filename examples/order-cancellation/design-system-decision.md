# Design-System Decision — Order Cancellation

## Reuse inventory

| Need | Existing token/component/pattern | Decision | Evidence |
|---|---|---|---|
| Destructive submit | `Button` destructive semantic variant | Reuse | Existing keyboard, focus, loading, and disabled-state tests |
| Reason selection | `SelectField` | Reuse | Supports label, description, field error, and required state |
| Optional detail | `TextAreaField` | Reuse | Supports character count and error association |
| Validation summary | `FormErrorSummary` | Reuse | Moves focus and links to invalid fields |
| Pending provider result | No stable product pattern | Add `OperationResult` component contract | Required by cancellation, refund, and bulk-import flows |

## New semantic tokens

The example token file adds status-purpose tokens for danger and pending surfaces. Product code must not reference raw palette coordinates.

## Proposed component

`OperationResult` represents accepted asynchronous work with `pending`, `completed`, and `failed` semantic states. It is not specific to orders or payment providers.

See [`component-contract.yaml`](./component-contract.yaml).

## Rejected alternatives

- Reusing a generic toast was rejected because the result must remain durable, focusable, and visible after navigation or refresh.
- A cancellation-specific result component was rejected because the behavior repeats across other durable operations.
