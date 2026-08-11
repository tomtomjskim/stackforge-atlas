# Backend Interface Design

## Purpose

Backend interfaces exist to support domain behavior and product experiences across change. They should not expose storage layout or force clients to reconstruct business rules from low-level CRUD operations.

## Design order

For each operation, decide in this order:

1. **User intent** — what outcome is the actor requesting?
2. **Domain command or query** — what business action or information request represents that intent?
3. **Authorization** — who may attempt it, and what object-level checks apply?
4. **Invariants** — what must remain true before and after execution?
5. **Input contract** — required data, normalization, validation ownership, and sensitive fields.
6. **Success contract** — returned representation, freshness, side effects, and next actions.
7. **Failure contract** — stable error codes, field errors, retryability, and user-safe messages.
8. **Concurrency and idempotency** — duplicate requests, stale versions, locks, and conditional updates.
9. **Observability** — operation name, trace identifier, audit event, metrics, and safe diagnostic context.
10. **Compatibility** — additive change, deprecation, migration, and rollback behavior.

## UI-to-interface questions

| UI concern | Interface decision |
|---|---|
| Initial rendering | One query, composed backend response, or parallel dependencies? |
| Loading | Expected latency, timeout, cancellation, and progressive response? |
| Empty state | Valid empty result or hidden error? |
| Validation | Client convenience rule, authoritative domain rule, or both? |
| Permissions | Capability discovery, object-level denial, and information leakage? |
| Submission | Idempotency key, duplicate-click handling, and processing state? |
| Conflict | Version field, ETag, conditional request, or domain-specific resolution? |
| Partial failure | Atomic operation, compensating action, or independently recoverable sections? |
| Retry | Safe automatically, safe only with idempotency, or unsafe? |
| Success feedback | Updated resource, operation receipt, async job, or redirect target? |

## Contract formats

- Use **OpenAPI 3.2.0** for synchronous HTTP APIs unless a project has a compatibility reason to remain on an earlier supported version.
- Use **AsyncAPI 3.0.0** for message-driven interfaces where channels, operations, messages, correlation, and delivery semantics matter.
- Use **JSON Schema 2020-12** for repository-owned structured artifacts and payload schemas where the selected interface specification supports it.

A contract file is not sufficient by itself. It must be linted, tested against implementation behavior, and connected to consumer expectations.

## Error envelope

A stable error contract separates machine action from human explanation.

```json
{
  "code": "ORDER_STATE_CONFLICT",
  "message": "The order changed while this page was open.",
  "fieldErrors": [],
  "retryable": false,
  "traceId": "8f6d2f...",
  "details": {
    "currentState": "SHIPPED"
  }
}
```

Rules:

- `code` is stable and documented; clients do not branch on prose.
- `message` is safe for the intended audience and may be localized by the client.
- `fieldErrors` use stable field paths and reason codes.
- `traceId` supports diagnosis but reveals no secret.
- `details` is bounded and does not leak internal stack traces, SQL, tokens, or unauthorized object facts.

## Data-shape rules

- Specify nullability, absence, empty collections, and default behavior explicitly.
- Use consistent time format, timezone semantics, identifiers, money representation, and decimal precision.
- Prefer cursor pagination for unstable or large ordered datasets; document ordering guarantees.
- Do not return every database column "for future use".
- Separate read models from write commands when their stability and authorization needs differ.
- Treat file upload, webhooks, long-running jobs, and bulk operations as distinct interface patterns.

## High-risk operation requirements

Money, inventory, identity, permissions, and irreversible actions should define:

- idempotency scope and expiration;
- audit actor, reason, source, and result;
- optimistic or pessimistic concurrency strategy;
- transactional boundary and external-side-effect handling;
- retry and reconciliation process;
- compensating or reversal operation;
- rate and abuse controls;
- rollback and incident evidence.

## References

- OpenAPI Specification 3.2.0: <https://spec.openapis.org/oas/v3.2.0.html>
- AsyncAPI Specification 3.0.0: <https://www.asyncapi.com/docs/reference/specification/v3.0.0>
- JSON Schema 2020-12: <https://json-schema.org/draft/2020-12>
