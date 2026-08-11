# User Flow — Order Cancellation

```mermaid
flowchart TD
    A[Open owned order] --> B{Can view order?}
    B -- no --> C[Permission-safe unavailable state]
    B -- yes --> D{Cancellation capability present?}
    D -- no --> E[Explain current state and available support path]
    D -- yes --> F[Open cancellation panel]
    F --> G[Choose reason and submit]
    G --> H{Authoritative validation}
    H -- invalid --> I[Preserve input and identify errors]
    I --> G
    H -- valid --> J{Conditional state transition}
    J -- stale/conflict --> K[Refresh order and explain changed eligibility]
    J -- accepted --> L{Provider outcome}
    L -- completed --> M[Show cancelled order and reversal summary]
    L -- delayed/timeout --> N[Show durable pending receipt]
    N --> O[Reconciliation updates final outcome]
    L -- terminal failure --> P[Show safe support path and retained operation reference]
```

## Recovery details

- Refreshing or repeating the request with the same idempotency key returns the existing operation receipt.
- A new idempotency key cannot bypass an existing protected transition.
- Input is preserved for validation errors but cleared after an accepted operation.
- Focus moves to the cancellation result heading after submission.
