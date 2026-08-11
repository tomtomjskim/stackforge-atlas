# User Flow — Feature Name

## Preconditions

- Actor is authenticated and has the required object-level permission.
- Required source data is available or the flow defines a recoverable unavailable state.

## Flow

```mermaid
flowchart TD
    A[Enter feature] --> B{Data available?}
    B -- no, retryable --> C[Show recoverable error]
    C --> B
    B -- no, forbidden --> D[Show permission-safe state]
    B -- yes --> E[Review current state]
    E --> F[Submit action]
    F --> G{Validation valid?}
    G -- no --> H[Preserve input and identify errors]
    H --> F
    G -- yes --> I{Operation result}
    I -- conflict --> J[Explain stale data and refresh]
    I -- pending --> K[Show pending receipt]
    I -- failed --> L[Show safe retry or support path]
    I -- success --> M[Show updated state and next action]
```

## Exit and recovery rules

- Define where focus moves after each terminal result.
- Define whether input is preserved on failure.
- Define whether browser back, refresh, or repeated submission is safe.
- Define the route or action that returns to the previous context.
