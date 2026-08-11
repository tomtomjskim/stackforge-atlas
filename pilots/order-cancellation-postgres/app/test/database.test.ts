import assert from "node:assert/strict";
import test from "node:test";
import { createDatabasePool, type DatabasePool, waitForDatabase } from "../src/db.ts";
import { migrate } from "../src/migrate.ts";
import { seedOrder } from "../src/seed.ts";
import {
  ApplicationError,
  PostgresOrderCancellationService,
} from "../src/service.ts";
import {
  PostgresIdempotentProviderGateway,
  PostgresOutboxWorker,
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

async function createFixture(): Promise<{
  pool: DatabasePool;
  service: PostgresOrderCancellationService;
}> {
  const pool = createDatabasePool(databaseUrl);
  await waitForDatabase(pool);
  await migrate(pool);
  await resetDatabase(pool);
  return {
    pool,
    service: new PostgresOrderCancellationService(pool),
  };
}

const validBody = {
  reasonCode: "ORDERED_BY_MISTAKE",
  expectedVersion: 1,
};

test("accepted command atomically persists order transition, outbox, and audit evidence", async () => {
  const { pool, service } = await createFixture();
  try {
    const receipt = await service.requestCancellation({
      actorId: "customer-1",
      orderId: "order-1001",
      idempotencyKey: "idem-order-1001-0001",
      body: validBody,
      traceId: "trace-atomic",
    });
    assert.equal(receipt.status, "PENDING");

    const snapshot = await pool.query(`
      SELECT
        (SELECT count(*)::integer FROM order_cancellations) AS cancellations,
        (SELECT count(*)::integer FROM outbox_events) AS outbox_events,
        (SELECT count(*)::integer FROM audit_events) AS audit_events,
        (SELECT payment_status FROM orders WHERE id = 'order-1001') AS payment_status
    `);
    assert.deepEqual(snapshot.rows[0], {
      cancellations: 1,
      outbox_events: 1,
      audit_events: 1,
      payment_status: "REFUND_PENDING",
    });
  } finally {
    await pool.end();
  }
});

test("same idempotency key replays across transactions while changed payload conflicts", async () => {
  const { pool, service } = await createFixture();
  try {
    const first = await service.requestCancellation({
      actorId: "customer-1",
      orderId: "order-1001",
      idempotencyKey: "idem-order-1001-0001",
      body: validBody,
      traceId: "trace-original",
    });
    const replay = await service.requestCancellation({
      actorId: "customer-1",
      orderId: "order-1001",
      idempotencyKey: "idem-order-1001-0001",
      body: validBody,
      traceId: "trace-retry",
    });

    assert.equal(replay.cancellationId, first.cancellationId);
    assert.equal(replay.traceId, "trace-original");

    await assert.rejects(
      service.requestCancellation({
        actorId: "customer-1",
        orderId: "order-1001",
        idempotencyKey: "idem-order-1001-0001",
        body: { ...validBody, reasonCode: "DUPLICATE_ORDER" },
      }),
      (error: unknown) =>
        error instanceof ApplicationError &&
        error.statusCode === 409 &&
        error.code === "ORDER_STATE_CONFLICT",
    );

    const counts = await pool.query(`
      SELECT
        (SELECT count(*)::integer FROM order_cancellations) AS cancellations,
        (SELECT count(*)::integer FROM outbox_events) AS outbox_events
    `);
    assert.deepEqual(counts.rows[0], {
      cancellations: 1,
      outbox_events: 1,
    });
  } finally {
    await pool.end();
  }
});

test("concurrent distinct keys accept one protected transition and one outbox event", async () => {
  const { pool, service } = await createFixture();
  try {
    const results = await Promise.allSettled([
      service.requestCancellation({
        actorId: "customer-1",
        orderId: "order-1001",
        idempotencyKey: "idem-order-1001-0001",
        body: validBody,
      }),
      service.requestCancellation({
        actorId: "customer-1",
        orderId: "order-1001",
        idempotencyKey: "idem-order-1001-0002",
        body: validBody,
      }),
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof ApplicationError);
    assert.equal(rejected.reason.statusCode, 409);

    const counts = await pool.query(`
      SELECT
        (SELECT count(*)::integer FROM order_cancellations) AS cancellations,
        (SELECT count(*)::integer FROM outbox_events) AS outbox_events,
        (SELECT count(*)::integer FROM audit_events) AS audit_events
    `);
    assert.deepEqual(counts.rows[0], {
      cancellations: 1,
      outbox_events: 1,
      audit_events: 1,
    });
  } finally {
    await pool.end();
  }
});

test("accepted operation survives application instance restart and completes from persisted outbox", async () => {
  const firstPool = createDatabasePool(databaseUrl);
  await waitForDatabase(firstPool);
  await migrate(firstPool);
  await resetDatabase(firstPool);

  const firstService = new PostgresOrderCancellationService(firstPool);
  const accepted = await firstService.requestCancellation({
    actorId: "customer-1",
    orderId: "order-1001",
    idempotencyKey: "idem-order-1001-0001",
    body: validBody,
  });
  await firstPool.end();

  const restartedPool = createDatabasePool(databaseUrl);
  try {
    const restartedService = new PostgresOrderCancellationService(restartedPool);
    const before = await restartedService.getCancellation(
      "customer-1",
      accepted.cancellationId,
    );
    assert.equal(before.status, "PENDING");

    const worker = new PostgresOutboxWorker({
      pool: restartedPool,
      gateway: new PostgresIdempotentProviderGateway(restartedPool),
      workerId: "restart-worker",
    });
    assert.equal(await worker.runOnce(), "completed");

    const completed = await restartedService.getCancellation(
      "customer-1",
      accepted.cancellationId,
    );
    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.refund?.amountMinor, 129000);
  } finally {
    await restartedPool.end();
  }
});

test("expired worker lease recovers after provider effect without duplicating the effect row", async () => {
  const { pool, service } = await createFixture();
  try {
    const accepted = await service.requestCancellation({
      actorId: "customer-1",
      orderId: "order-1001",
      idempotencyKey: "idem-order-1001-0001",
      body: validBody,
    });

    const gateway = new PostgresIdempotentProviderGateway(pool);
    await gateway.cancel({
      cancellationId: accepted.cancellationId,
      orderId: "order-1001",
      customerId: "customer-1",
      amountMinor: 129000,
      currency: "KRW",
      traceId: accepted.traceId,
    });
    await pool.query(`
      UPDATE outbox_events
      SET
        locked_by = 'dead-worker',
        locked_at = clock_timestamp() - interval '120 seconds',
        attempts = 1
      WHERE aggregate_id = $1
    `, [accepted.cancellationId]);

    const recoveryWorker = new PostgresOutboxWorker({
      pool,
      gateway,
      workerId: "recovery-worker",
      leaseSeconds: 30,
    });
    assert.equal(await recoveryWorker.runOnce(), "completed");

    const effect = await pool.query(
      `
        SELECT count(*)::integer AS rows, max(call_count)::integer AS calls
        FROM provider_cancellation_effects
        WHERE cancellation_id = $1
      `,
      [accepted.cancellationId],
    );
    assert.deepEqual(effect.rows[0], { rows: 1, calls: 2 });

    const completed = await service.getCancellation(
      "customer-1",
      accepted.cancellationId,
    );
    assert.equal(completed.status, "COMPLETED");
  } finally {
    await pool.end();
  }
});

test("two workers use skip locked so one event is not processed concurrently", async () => {
  const { pool, service } = await createFixture();
  try {
    const accepted = await service.requestCancellation({
      actorId: "customer-1",
      orderId: "order-1001",
      idempotencyKey: "idem-order-1001-0001",
      body: validBody,
    });
    const gateway = new PostgresIdempotentProviderGateway(pool);
    const workerA = new PostgresOutboxWorker({
      pool,
      gateway,
      workerId: "worker-a",
    });
    const workerB = new PostgresOutboxWorker({
      pool,
      gateway,
      workerId: "worker-b",
    });

    const results = await Promise.all([workerA.runOnce(), workerB.runOnce()]);
    assert.deepEqual(results.sort(), ["completed", "idle"]);

    const effect = await pool.query(
      `
        SELECT count(*)::integer AS rows, max(call_count)::integer AS calls
        FROM provider_cancellation_effects
        WHERE cancellation_id = $1
      `,
      [accepted.cancellationId],
    );
    assert.deepEqual(effect.rows[0], { rows: 1, calls: 1 });
  } finally {
    await pool.end();
  }
});

test("audit events reject update and delete mutations", async () => {
  const { pool, service } = await createFixture();
  try {
    await service.requestCancellation({
      actorId: "customer-1",
      orderId: "order-1001",
      idempotencyKey: "idem-order-1001-0001",
      body: validBody,
    });

    await assert.rejects(
      pool.query("UPDATE audit_events SET result = 'ALTERED'"),
      /append-only/,
    );
    await assert.rejects(
      pool.query("DELETE FROM audit_events"),
      /append-only/,
    );
  } finally {
    await pool.end();
  }
});
