# UI-Backend Traceability

## Why traceability exists

A design can look complete while depending on backend behavior that does not exist. An API can be technically correct while providing no usable recovery path. Traceability makes those mismatches visible before implementation and keeps future changes from breaking an unseen consumer assumption.

## Traceability chain

```text
User outcome
→ user flow step
→ screen region or action
→ screen state
→ command or query
→ interface operation
→ domain rule
→ data owner
→ observability event
→ acceptance and failure test
```

Every high-risk user action should be traceable through the full chain.

## Minimum matrix

| UI ID | User intent | State or action | Interface operation | Domain rule | Failure behavior | Evidence |
|---|---|---|---|---|---|---|
| `submit-cancellation` | Cancel an eligible order | Submit | `requestOrderCancellation` | Paid, unshipped, actor owns order | Field error, state conflict, provider pending, system error | Contract, integration, concurrency, E2E |

## Design-time rules

1. A visible action without an interface operation is unresolved design work.
2. An interface operation without a visible or machine consumer is a candidate for removal or separate justification.
3. A domain rule duplicated independently in UI and backend needs an authoritative owner and drift test.
4. A backend error without a mapped screen state produces generic failure and is incomplete.
5. A destructive action without audit and recovery behavior is incomplete.
6. An async operation must expose pending, success, delayed, duplicate, and terminal-failure behavior.

## Change-impact procedure

When a feature changes:

1. Identify affected matrix rows.
2. Determine whether intent, visual behavior, domain rules, or only implementation changes.
3. Update the authoritative contract first.
4. Search all consumers of changed operations, tokens, components, and error codes.
5. Run the evidence linked by the affected rows.
6. Update the matrix only when the relationship changed; do not churn prose for unrelated refactors.

## Source-of-truth order

- Product and domain meaning: feature brief and domain documentation.
- Screen behavior: screen contract.
- Transport behavior: OpenAPI or AsyncAPI contract.
- Executable truth: implementation and tests.
- Historical rationale: ADR.
- Operational recovery: runbook.

Conflicts between sources are defects. The team must resolve which behavior is intended rather than selecting the most convenient document.
