# Traceability Matrix — Feature Name

| UI ID | User intent | State/action | Interface operation | Domain rule | Failure behavior | Evidence |
|---|---|---|---|---|---|---|
| `summary` | Understand current eligibility | Ready | `getFeature` | Actor can view target | Forbidden state does not disclose protected data | Contract + authorization integration |
| `reason-code` | Provide required reason | Validation | `performFeatureOperation` | Reason is required and allowed | Preserve input, field error, summary focus | Schema + component interaction + E2E |
| `submit-feature` | Perform action once | Submitting | `performFeatureOperation` | Target eligible; duplicate request idempotent | Conflict, pending receipt, retry-safe error | Concurrency + idempotency + integration |
| `operation-result` | Understand outcome | Success/error | `performFeatureOperation` | Returned status matches durable state | Announce result and expose next action | Accessibility + E2E |

## Change notes

- Record contract additions, removals, and changed failure semantics.
- Link to ADRs for deliberate exceptions or breaking changes.
