# Product-Interface Delivery

## Purpose

This workflow turns a product request into a buildable, reviewable, and maintainable feature slice. It prevents UI design, backend design, and implementation from becoming separate interpretations of the same request.

## Required artifacts

A medium- or high-risk feature should have:

1. **Feature brief** — problem, outcome, actors, scope, non-goals, invariants, and risk.
2. **User flow** — entry points, decisions, alternate paths, cancellation, and recovery.
3. **Screen contracts** — information hierarchy, actions, responsive behavior, permissions, data dependencies, and state matrix.
4. **Design-system decision** — reused primitives and components, new semantic tokens, exceptions, and deprecations.
5. **Backend interface contract** — operations, schemas, errors, authorization, concurrency, idempotency, and observability.
6. **Traceability matrix** — visible behavior mapped to domain rules, interface operations, and tests.
7. **Implementation and verification plan** — sequence, compatibility, migration, rollback, and evidence.
8. **Review report** — adversarial findings, dispositions, unresolved risk, and follow-up.

Low-risk work may combine artifacts, but it must not silently omit material states or verification.

## Delivery gates

### Gate 0 — Outcome is testable

Proceed only when the team can answer:

- Who experiences the problem?
- What observable result should change?
- What is explicitly outside the task?
- Which domain invariants must remain true?
- What would make the change unsafe or unsuccessful?

### Gate 1 — Flow is coherent

The user flow includes normal entry, alternate paths, cancellation, retry, and terminal outcomes. Every decision point has an owner: user choice, permission rule, domain rule, or system failure.

### Gate 2 — Screens are state-complete

Each surface defines what it shows and permits when data is loading, absent, stale, partial, rejected, forbidden, conflicted, or successfully updated. The wireframe is annotated with data and action dependencies.

### Gate 3 — Interfaces can support the experience

Every visible action maps to an explicit command or query. The interface defines validation, authorization, failure semantics, idempotency, concurrency behavior, and traceability. No screen depends on unspecified backend behavior.

### Gate 4 — Implementation is bounded

The plan identifies affected modules, compatibility constraints, migration needs, tests, rollout, and rollback. The agent or engineer is free to choose local implementation details inside those boundaries.

### Gate 5 — Evidence covers the risk

The relevant component, accessibility, contract, integration, end-to-end, security, and failure tests pass. Skipped checks and environmental limitations remain visible.

### Gate 6 — Future work can find the truth

Changed architecture, domain flow, interfaces, or operating behavior is reflected in the source map, ADR, contract, or runbook. Temporary reasoning logs are not promoted to permanent documentation unless they remain useful.

## Agent session pattern

```text
Map current behavior
→ State assumptions and unknowns
→ Produce or repair the feature contracts
→ Plan the smallest coherent implementation
→ Build
→ Run risk-based verification
→ Review from adversarial perspectives
→ Repair blockers and major findings
→ Update durable knowledge
→ Report evidence and residual uncertainty
```

The harness should stop when acceptance criteria and quality gates are satisfied, not after an arbitrary number of turns.
