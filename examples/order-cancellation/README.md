# Worked Example — Order Cancellation

This example demonstrates one vertical feature slice for a customer requesting cancellation of a paid, unshipped order.

It is intentionally small but includes the contracts that generated code often leaves implicit:

- eligibility and ownership rules;
- loading, stale, forbidden, conflict, pending, failure, and success states;
- an idempotent command interface;
- UI-to-domain-to-test traceability;
- semantic design-token additions rather than page-local styling.

## Walkthrough

1. Read [`feature.yaml`](./feature.yaml) for scope, invariants, and risk.
2. Follow [`user-flow.md`](./user-flow.md) for alternate outcomes.
3. Compare [`wireframe.md`](./wireframe.md) with [`screen-contract.yaml`](./screen-contract.yaml).
4. Review [`design-system-decision.md`](./design-system-decision.md) and the reusable component contract.
5. Review [`openapi.yaml`](./openapi.yaml) for the command and error contract.
6. Use [`traceability-matrix.md`](./traceability-matrix.md) to verify that visible behavior has backend and test support.

This is a design and contract example, not a production order or payment implementation.
