import assert from "node:assert/strict";
import test from "node:test";
import {
  createDatabasePool,
  type DatabasePool,
  waitForDatabase,
} from "../src/db.ts";
import { migrate } from "../src/migrate.ts";
import { seedOrder } from "../src/seed.ts";
import { PostgresOrderCancellationService } from "../src/service.ts";
import {
  PostgresOutboxWorker,
  type CancellationProviderGateway,
} from "../src/worker.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for PostgreSQL pilot tests");
}

async function resetDatabase(pool: DatabasePool): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      audit_events,
      provider_cancellation_effects,
      outbox_events,
      order_cancellations,
      orders
    RESTART IDENTITY CASCADE
  `);
  await seedOrder(pool);
}


class UnknownOutcomeGateway implements CancellationProviderGateway {
  async cancel(): Promise<never> {
    throw new Error("provider timeout after unknown outcome");
  }
}

class TerminalFailureGateway implements CancellationProviderGateway {
  async cancel(
    input: Parameters<CancellationProviderGateway["cancel"]>[0],
  ): Promise<{
    status: "FAILED";
    outcomeCode: string;
    providerReference: string;
  }> {
    return {
      status: "FAILED",
      outcomeCode: "PROVIDER_REJECTED",
      providerReference: `provider_${input.cancellationId}`,
    };
  }
}

test("terminal provider failure releases the order for a new versioned attempt", async () => {
  const pool = createDatabasePool(databaseUrl);
  await waitForDatabase(pool);
  await migrate(pool);
  await resetDatabase(pool);
  const service = new PostgresOrderCancellationService(pool);

  try {
    const first = await service.requestCancellation({
      actorId: "customer-1",
      orderId: "order-1001",
      idempotencyKey: "idem-order-1001-0001",
      body: {
        reasonCode: "ORDERED_BY_MISTAKE",
        expectedVersion: 1,
      },
    });
    const worker = new PostgresOutboxWorker({
      pool,
      gateway: new TerminalFailureGateway(),
      workerId: "failure-worker",
    });
    assert.equal(await worker.runOnce(), "failed");

    const failed = await service.getCancellation(
      "customer-1",
      first.cancellationId,
    );
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.outcomeCode, "PROVIDER_REJECTED");

    const context = await service.getContext("customer-1", "order-1001");
    assert.equal(context.capability.allowed, true);
    assert.equal(context.paymentStatus, "PAID");

    const second = await service.requestCancellation({
      actorId: "customer-1",
      orderId: "order-1001",
      idempotencyKey: "idem-order-1001-0002",
      body: {
        reasonCode: "DUPLICATE_ORDER",
        expectedVersion: context.orderVersion,
      },
    });
    assert.notEqual(second.cancellationId, first.cancellationId);

    const count = await pool.query(
      "SELECT count(*)::integer AS cancellations FROM order_cancellations WHERE order_id = $1",
      ["order-1001"],
    );
    assert.equal(count.rows[0]?.cancellations, 2);
  } finally {
    await pool.end();
  }
});


test("retry exhaustion keeps the operation pending for reconciliation instead of declaring failure", async () => {
  const pool = createDatabasePool(databaseUrl);
  await waitForDatabase(pool);
  await migrate(pool);
  await resetDatabase(pool);
  const service = new PostgresOrderCancellationService(pool);

  try {
    const accepted = await service.requestCancellation({
      actorId: "customer-1",
      orderId: "order-1001",
      idempotencyKey: "idem-order-1001-0001",
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

    const pending = await service.getCancellation(
      "customer-1",
      accepted.cancellationId,
    );
    assert.equal(pending.status, "PENDING");
    assert.equal(pending.outcomeCode, "RECONCILIATION_REQUIRED");

    const snapshot = await pool.query(`
      SELECT
        (SELECT payment_status FROM orders WHERE id = 'order-1001') AS payment_status,
        (SELECT cancellation_id FROM orders WHERE id = 'order-1001') AS cancellation_id,
        (SELECT published_at FROM outbox_events WHERE aggregate_id = $1) AS published_at,
        (SELECT reconciliation_required_at IS NOT NULL FROM outbox_events WHERE aggregate_id = $1) AS reconciliation_required,
        (SELECT count(*)::integer FROM audit_events WHERE action = 'ORDER_CANCELLATION_RECONCILIATION_REQUIRED') AS reconciliation_audits
    `, [accepted.cancellationId]);
    assert.deepEqual(snapshot.rows[0], {
      payment_status: "REFUND_PENDING",
      cancellation_id: accepted.cancellationId,
      published_at: null,
      reconciliation_required: true,
      reconciliation_audits: 1,
    });

    const secondWorker = new PostgresOutboxWorker({
      pool,
      gateway: new UnknownOutcomeGateway(),
      workerId: "second-worker",
      maxAttempts: 1,
    });
    assert.equal(await secondWorker.runOnce(), "idle");
  } finally {
    await pool.end();
  }
});
