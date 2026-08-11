# Traceability Matrix — Feature Name

| UI ID | User intent | State/action | Interface operation | Domain rule | Failure behavior | Evidence |
|---|---|---|---|---|---|---|
| `summary` | Understand current eligibility | Loading/ready/stale | `getFeatureSurface` | Actor can view target; capability is authoritative | Forbidden or unavailable state does not disclose protected data | Contract + authorization integration |
| `reason-code` | Choose an allowed reason | Ready/validation | `getFeatureSurface` + `performFeatureOperation` | Option list is current; submitted reason is authoritative | Preserve input, field error, summary focus | Schema + component interaction + E2E |
| `submit-feature` | Perform action once | Submitting | `performFeatureOperation` | Target eligible; duplicate request is idempotent | Conflict, durable pending receipt, retry-safe rejection | Concurrency + idempotency + integration |
| `operation-result` | Understand durable outcome | Pending/success/terminal error | `getFeatureOperation` | Accepted operation remains queryable until terminal retention expires | Bounded polling, accessible announcement, supported recovery | Accessibility + status contract + E2E |

## Change notes

- Record contract additions, removals, and changed failure semantics.
- Link to ADRs for deliberate exceptions or breaking changes.
