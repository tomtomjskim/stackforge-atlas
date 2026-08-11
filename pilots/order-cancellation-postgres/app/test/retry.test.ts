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
