import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createDatabasePool,
  type DatabasePool,
  waitForDatabase,
} from "../src/db.ts";
import { createRequestHandler, type LogEvent } from "../src/http.ts";
import { migrate } from "../src/migrate.ts";
import { seedOrder } from "../src/seed.ts";
import { PostgresOrderCancellationService } from "../src/service.ts";
import {
  PostgresIdempotentProviderGateway,
  PostgresOutboxWorker,
} from "../src/worker.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for PostgreSQL pilot tests");
}

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const publicDirectory = join(
  currentDirectory,
  "..",
  "..",
  "..",
  "order-cancellation-node",
  "app",
  "public",
);

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

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

test("PostgreSQL HTTP contract survives worker handoff and durable status lookup", async () => {
  const pool = createDatabasePool(databaseUrl);
  await waitForDatabase(pool);
  await migrate(pool);
  await resetDatabase(pool);
  const service = new PostgresOrderCancellationService(pool);
  const events: LogEvent[] = [];
  const server = createServer(
    createRequestHandler({
      service,
      publicDirectory,
      healthcheck: async () => {
        await pool.query("SELECT 1");
      },
      logger: (event) => events.push(event),
    }),
  );
  const origin = await listen(server);

  try {
    const contextResponse = await fetch(
      `${origin}/orders/order-1001/cancellation-context`,
      { headers: { Authorization: "Bearer customer-1" } },
    );
    assert.equal(contextResponse.status, 200);
    const context = (await contextResponse.json()) as {
      orderVersion: number;
      capability: { allowed: boolean };
    };
    assert.equal(context.orderVersion, 1);
    assert.equal(context.capability.allowed, true);

    const commandResponse = await fetch(
      `${origin}/orders/order-1001/cancellations`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer customer-1",
          "Content-Type": "application/json",
          "Idempotency-Key": "idem-order-1001-0001",
        },
        body: JSON.stringify({
          reasonCode: "ORDERED_BY_MISTAKE",
          expectedVersion: 1,
        }),
      },
    );
    assert.equal(commandResponse.status, 202);
    const location = commandResponse.headers.get("location");
    assert.ok(location);
    const pending = (await commandResponse.json()) as { status: string };
    assert.equal(pending.status, "PENDING");

    const worker = new PostgresOutboxWorker({
      pool,
      gateway: new PostgresIdempotentProviderGateway(pool),
      workerId: "http-test-worker",
    });
    assert.equal(await worker.runOnce(), "completed");

    const statusResponse = await fetch(`${origin}${location}`, {
      headers: { Authorization: "Bearer customer-1" },
    });
    assert.equal(statusResponse.status, 200);
    const completed = (await statusResponse.json()) as {
      status: string;
      refund: { amountMinor: number };
    };
    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.refund.amountMinor, 129000);

    assert.ok(
      events.some((event) => event.route === "requestOrderCancellation"),
    );
    const serializedEvents = JSON.stringify(events);
    assert.equal(serializedEvents.includes("Bearer customer-1"), false);
    assert.equal(serializedEvents.includes("ORDERED_BY_MISTAKE"), false);
  } finally {
    await close(server);
    await pool.end();
  }
});

test("PostgreSQL HTTP boundary serves shared UI, database health, and stable auth errors", async () => {
  const pool = createDatabasePool(databaseUrl);
  await waitForDatabase(pool);
  await migrate(pool);
  await resetDatabase(pool);
  const service = new PostgresOrderCancellationService(pool);
  const server = createServer(
    createRequestHandler({
      service,
      publicDirectory,
      healthcheck: async () => {
        await pool.query("SELECT 1");
      },
    }),
  );
  const origin = await listen(server);

  try {
    const ui = await fetch(origin);
    assert.equal(ui.status, 200);
    assert.match(await ui.text(), /Order cancellation/);

    const health = await fetch(`${origin}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: "ok",
      database: "ready",
    });

    const unauthorized = await fetch(
      `${origin}/orders/order-1001/cancellation-context`,
    );
    assert.equal(unauthorized.status, 401);
    const error = (await unauthorized.json()) as {
      code: string;
      retryable: boolean;
      traceId: string;
    };
    assert.equal(error.code, "AUTHENTICATION_REQUIRED");
    assert.equal(error.retryable, false);
    assert.ok(error.traceId);
  } finally {
    await close(server);
    await pool.end();
  }
});
