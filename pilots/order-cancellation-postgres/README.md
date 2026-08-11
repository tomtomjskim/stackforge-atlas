# Durability Pilot — Order Cancellation on PostgreSQL

This pilot takes the same order-cancellation product, screen, and OpenAPI contracts used by the Node.js in-memory pilot and changes one variable: **the authoritative state now lives in PostgreSQL**.

The purpose is not to claim production readiness. It is to verify that an accepted high-risk command survives application-instance replacement and that the database makes the following relationships explicit:

```text
customer command
    ↓
idempotency identity
    ↓
locked order decision
    ↓
cancellation operation
    + order state transition
    + outbox event
    + audit event
    ↓ one transaction commits
worker lease
    ↓
idempotent provider effect
    ↓
completed, failed, or reconciliation-required durable result
```

## What this proves

- one `Read Committed` transaction protects order eligibility with a row lock;
- the actor-scoped idempotency key is serialized and constrained in PostgreSQL;
- order state, cancellation operation, outbox work, and audit evidence commit atomically;
- the provider call occurs **after** commit, outside the database transaction;
- workers claim work with `FOR UPDATE SKIP LOCKED` and a reclaimable lease;
- an expired worker claim can recover after the provider effect without creating a second effect row;
- exhausted transport retries preserve a `PENDING` operation for reconciliation instead of declaring a possibly false failure;
- pending operations and outbox rows survive application pool replacement;
- audit rows reject `UPDATE` and `DELETE`;
- the three shared OpenAPI operations and the previously built browser UI remain unchanged.

## Run with Docker Compose

Requirements: Docker with Compose support.

```bash
cd pilots/order-cancellation-postgres
docker compose up
```

Open `http://127.0.0.1:3001`. The seeded fixture remains:

```text
actor: customer-1
order: order-1001
```

PostgreSQL is exposed on local port `55432` for inspection.

## Run against an existing PostgreSQL 18 instance

```bash
export DATABASE_URL='postgresql://stackforge:stackforge@127.0.0.1:5432/stackforge'

cd pilots/order-cancellation-postgres/app
npm ci --ignore-scripts --no-audit --no-fund
npm run migrate
npm run seed
npm run check
```

Run the HTTP and worker processes separately:

```bash
npm start
npm run worker
```

## Read the evidence

1. [`project-map.yaml`](./project-map.yaml) describes boundaries, transaction ownership, recovery, and known gaps.
2. [`durability-manifest.yaml`](./durability-manifest.yaml) records the migration, protected resources, outbox lease, provider identity, audit enforcement, and recovery evidence.
3. [`implementation-manifest.yaml`](./implementation-manifest.yaml) maps the shared OpenAPI operations to handlers and tests.
4. [`evaluation/eval-case.yaml`](./evaluation/eval-case.yaml) fixes the durability scenarios for later PostgreSQL, MySQL, Python, PHP, and harness comparisons.
5. [`migrations/001_order_cancellation.sql`](./migrations/001_order_cancellation.sql) is the executable schema.
6. [`app/test/database.test.ts`](./app/test/database.test.ts) exercises transaction, rollback, concurrency, restart, lease, and audit behavior.
7. [`app/test/retry.test.ts`](./app/test/retry.test.ts) distinguishes explicit provider rejection from unknown transport outcome.

## Delivery semantics

This pilot deliberately does **not** use the phrase “exactly once.”

The database transaction guarantees that accepted local state and outbox work are committed together. A worker can still call an external provider and crash before recording the local result. The safe design is therefore:

```text
at-least-once worker delivery
+
stable provider idempotency identity
+
durable local reconciliation
```

The simulated provider stores one row per `cancellation_id` and increments a call counter when the same effect is observed again. This demonstrates convergence under duplicate delivery, not a real payment provider guarantee. When repeated calls still have an unknown outcome, the operation remains `PENDING` with `RECONCILIATION_REQUIRED`; it is not converted into a convenient but unsafe terminal failure.

## Evidence boundary

Current level: **Durable subset**.

Not yet proven:

- PostgreSQL process or host restart;
- WAL recovery, PITR, backup restore, replication, or failover;
- migration rollback drill against retained production-like data;
- real payment-provider timeout and reconciliation;
- multi-region or high-latency behavior;
- lock contention, pool sizing, sustained throughput, or load shedding;
- production authentication, secret rotation, or row-level security;
- real-browser accessibility and visual regression.

Those remain separate evidence gates. A passing transaction test is not a substitute for database operations practice.
