import assert from "node:assert/strict";
import test from "node:test";
import {
  createDatabasePool,
  type DatabasePool,
  waitForDatabase,
} from "../src/db.ts";
import { migrate } from "../src/migrate.ts";
import { PostgresReconciliationService } from "../src/reconciliation.ts";
import { seedOrder } from "../src/seed.ts";
import {
  ApplicationError,
  PostgresOrderCancellationService,
} from "../src/service.ts";
import {
  PostgresOutboxWorker,
  type CancellationProviderGateway,
} from "../src/worker.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for PostgreSQL pilot tests");
}

class UnknownOutcomeGateway implements CancellationProviderGateway {
  async cancel(
    _input: Parameters<CancellationProviderGateway["cancel"]>[0],
  ): Promise<never> {
    throw new Error("provider response was lost");
  }
}

async function resetDatabase(pool: DatabasePool): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      reconciliation_cases,
      audit_events,
      provider_cancellation_effects,
      outbox_events,
      order_cancellations,
      orders
    RESTART IDENTITY CASCADE
  `);
  await seedOrder(pool);
}

async function createFixture(): Promise<{
  pool: DatabasePool;
  service: PostgresOrderCancellationService;
  reconciliation: PostgresReconciliationService;
}> {
  const pool = createDatabasePool(databaseUrl);
  await waitForDatabase(pool);
  await migrate(pool);
  await resetDatabase(pool);
  return {
    pool,
    service: new PostgresOrderCancellationService(pool),
    reconciliation: new PostgresReconciliationService(pool),
  };
}

async function createOpenCase(
  pool: DatabasePool,
  service: PostgresOrderCancellationService,
): Promise<{ cancellationId: string; caseId: number }> {
  const accepted = await service.requestCancellation({
    actorId: "customer-1",
    orderId: "order-1001",
    idempotencyKey: "idem-order-1001-ops1",
    body: {
      reasonCode: "ORDERED_BY_MISTAKE",
      expectedVersion: 1,
    },
  });
  const worker = new PostgresOutboxWorker({
    pool,
    gateway: new UnknownOutcomeGateway(),
    workerId: "unknown-outcome-worker",
    maxAttempts: 1,
  });
  assert.equal(await worker.runOnce(), "reconciliation_required");

  const result = await pool.query(
    "SELECT id FROM reconciliation_cases WHERE cancellation_id = $1",
    [accepted.cancellationId],
  );
  return {
    cancellationId: accepted.cancellationId,
    caseId: Number(result.rows[0]?.id),
  };
}

test("unknown provider outcome opens an observable reconciliation case", async () => {
  const { pool, service, reconciliation } = await createFixture();
  try {
    const created = await createOpenCase(pool, service);
    const openCases = await reconciliation.listOpen();
    assert.equal(openCases.length, 1);
    assert.equal(openCases[0]?.caseId, created.caseId);
    assert.equal(openCases[0]?.cancellationId, created.cancellationId);
    assert.equal(openCases[0]?.status, "OPEN");

    const health = await reconciliation.getHealth();
    assert.equal(health.pendingCancellations, 1);
    assert.equal(health.openReconciliationCases, 1);
    assert.equal(health.readyOutboxEvents, 0);
  } finally {
    await pool.end();
  }
});

test("completed reconciliation resolves cancellation, order, outbox, and audit atomically", async () => {
  const { pool, service, reconciliation } = await createFixture();
  try {
    const created = await createOpenCase(pool, service);
    const resolved = await reconciliation.resolve({
      caseId: created.caseId,
      actorId: "ops-user-1",
      resolution: "COMPLETED",
      providerReference: "provider-confirmed-1001",
      note: "Provider status lookup confirmed completion.",
    });
    assert.equal(resolved.status, "RESOLVED_COMPLETED");
    assert.equal(resolved.providerReference, "provider-confirmed-1001");

    const snapshot = await pool.query(
      `
        SELECT
          cancellation.status AS cancellation_status,
          cancellation.outcome_code,
          orders.payment_status,
          event.published_at IS NOT NULL AS outbox_published,
          reconciliation.status AS reconciliation_status,
          (
            SELECT count(*)::integer
            FROM audit_events
            WHERE action = 'ORDER_CANCELLATION_RECONCILED'
          ) AS reconciliation_audits
        FROM order_cancellations AS cancellation
        JOIN orders ON orders.id = cancellation.order_id
        JOIN outbox_events AS event ON event.aggregate_id = cancellation.id
        JOIN reconciliation_cases AS reconciliation
          ON reconciliation.cancellation_id = cancellation.id
        WHERE cancellation.id = $1
      `,
      [created.cancellationId],
    );
    assert.deepEqual(snapshot.rows[0], {
      cancellation_status: "COMPLETED",
      outcome_code: "RECONCILED_PROVIDER_COMPLETED",
      payment_status: "REFUNDED",
      outbox_published: true,
      reconciliation_status: "RESOLVED_COMPLETED",
      reconciliation_audits: 1,
    });

    const replay = await reconciliation.resolve({
      caseId: created.caseId,
      actorId: "ops-user-1",
      resolution: "COMPLETED",
      providerReference: "provider-confirmed-1001",
    });
    assert.equal(replay.status, "RESOLVED_COMPLETED");

    await assert.rejects(
      reconciliation.resolve({
        caseId: created.caseId,
        actorId: "ops-user-2",
        resolution: "FAILED",
      }),
      (error: unknown) =>
        error instanceof ApplicationError &&
        error.statusCode === 409 &&
        error.code === "RECONCILIATION_ALREADY_RESOLVED",
    );

    const health = await reconciliation.getHealth();
    assert.equal(health.openReconciliationCases, 0);
    assert.equal(health.pendingCancellations, 0);
  } finally {
    await pool.end();
  }
});

test("failed reconciliation releases the order while preserving the failed operation", async () => {
  const { pool, service, reconciliation } = await createFixture();
  try {
    const created = await createOpenCase(pool, service);
    const resolved = await reconciliation.resolve({
      caseId: created.caseId,
      actorId: "ops-user-1",
      resolution: "FAILED",
      note: "Provider status lookup confirmed no cancellation effect.",
    });
    assert.equal(resolved.status, "RESOLVED_FAILED");

    const context = await service.getContext("customer-1", "order-1001");
    assert.equal(context.capability.allowed, true);
    assert.equal(context.paymentStatus, "PAID");

    const failed = await service.getCancellation(
      "customer-1",
      created.cancellationId,
    );
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.outcomeCode, "RECONCILED_PROVIDER_FAILED");
  } finally {
    await pool.end();
  }
});
