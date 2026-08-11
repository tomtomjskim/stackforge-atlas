# Runnable Pilot — Order Cancellation on Node.js

This pilot is the first implementation checkpoint for StackForge Atlas. It carries the existing order-cancellation feature slice into a working browser surface and HTTP service, then checks whether the shared design and interface contracts remain visible in code and tests.

It is deliberately small. The purpose is not to recommend a framework or pretend that an in-memory store is production-ready. The purpose is to expose where an agent can silently lose product intent while moving from documents to code.

## What is implemented

```text
Screen contract
    ↓
GET cancellation context
    ↓
Stateful browser surface
    ↓
POST idempotent cancellation command
    ↓
Protected domain transition
    ↓
202 durable receipt
    ↓
GET cancellation status
    ↓
Completed or failed terminal state
```

The implementation includes:

- a responsive browser screen with loading, unavailable, validation, submitting, conflict, pending, success, system-error, and terminal-error behavior;
- the three operations declared by `examples/order-cancellation/openapi.yaml`;
- owner scoping, optimistic version checks, idempotent replay, changed-payload conflict, and at-most-one accepted transition;
- a simulated delayed provider outcome and a durable cancellation resource;
- a browser-stored operation Location that resumes polling after refresh and is cleared at terminal completion;
- structured request completion logs that omit credentials and request bodies;
- domain and HTTP integration tests using the built-in Node.js test runner.

## Run

Node.js 24 is the declared pilot baseline.

```bash
cd pilots/order-cancellation-node/app
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm start
```

Open `http://127.0.0.1:3000` and use the seeded order `order-1001`. The browser uses the local fixture actor `customer-1`.

## Read the evidence

1. [`project-map.yaml`](./project-map.yaml) explains structure, risk, operations, and known gaps.
2. [`implementation-manifest.yaml`](./implementation-manifest.yaml) maps every OpenAPI operation to handlers and tests.
3. [`evaluation/eval-case.yaml`](./evaluation/eval-case.yaml) defines the reusable task and acceptance scenarios.
4. [`app/test/service.test.ts`](./app/test/service.test.ts) verifies domain invariants.
5. [`app/test/http.test.ts`](./app/test/http.test.ts) verifies the runnable HTTP and UI boundary.

## Adversarial boundary

This pilot does **not** prove production readiness.

- Authentication is a bearer fixture, not an identity system.
- State is in memory and disappears on restart.
- The provider is simulated.
- Browser automation, visual regression, load tests, database migrations, backup, and reconciliation after process loss are absent.
- Node's native HTTP adapter was selected to minimize framework-specific noise; it is not a recommendation to avoid mature frameworks.
- Pilot dependencies are committed through a lockfile, but a repository-wide dependency-update and provenance policy is not yet established.

Those omissions are explicit so later Python, PHP, database, and infrastructure pilots can test the same contract without inheriting false assumptions.
