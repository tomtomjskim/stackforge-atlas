# Engineering Constitution

These principles are stable defaults. A project may override them only through an explicit decision with rationale and consequences.

## 1. Intent precedes implementation

No framework, database, component, or endpoint is justified until the user outcome, domain behavior, scope, and non-goals are clear enough to test.

## 2. A feature is a vertical contract

A user-visible capability connects product intent, UI states, domain rules, interfaces, persistence, observability, and verification. Optimizing one layer while leaving the chain implicit creates local correctness and system-level ambiguity.

## 3. Meaningful states are designed, not discovered in production

Loading, empty, partial, stale, error, forbidden, offline, retrying, conflict, and success states must be considered when the domain can produce them.

## 4. Design systems encode decisions, not decoration

Tokens, primitives, components, and patterns exist to preserve semantic intent, accessibility, consistency, and changeability. A library of visually similar components without governance is not a design system.

## 5. Interfaces express domain behavior

Public interfaces should represent user and domain actions, not expose database tables or internal framework structure. Errors, authorization, idempotency, concurrency, and compatibility are part of the contract.

## 6. Evidence defines completion

Generated code, confident prose, or a passing happy-path demo is not evidence. Completion requires the relevant static checks, tests, migration checks, security review, and operating evidence for the task risk.

## 7. Rigor is proportional to risk

Money, identity, permissions, personal data, inventory, migrations, external integrations, and irreversible actions require stronger design and review gates than reversible presentation changes.

## 8. Security is observable behavior

Security requirements must be expressed as enforceable boundaries and negative tests. A checklist without verified authorization, input handling, secret protection, and failure behavior is insufficient.

## 9. Knowledge stays close to change

Contracts, ADRs, source maps, and runbooks live with the code or are generated from it. Documentation is updated when behavior or structure changes, not rewritten cosmetically on every task.

## 10. Rules are earned by repeated evidence

Do not expand the global harness for a one-off failure. Capture the case as an evaluation, reproduce it, and promote a rule only when it is general, durable, and cheaper than repeated failure.
