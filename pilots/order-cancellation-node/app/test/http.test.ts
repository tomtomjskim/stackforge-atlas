import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequestHandler, type LogEvent } from "../src/http.ts";
import {
  OrderCancellationService,
  type CancellationGateway,
} from "../src/service.ts";
import { InMemoryCancellationStore } from "../src/store.ts";

const publicDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

class ImmediateGateway implements CancellationGateway {
  calls = 0;

  async cancel() {
    this.calls += 1;
    return { status: "COMPLETED" } as const;
  }
}

async function startFixture() {
  const store = new InMemoryCancellationStore(() => `cancel_${randomUUID()}`);
  store.seedOrder({
    id: "order-1001",
    customerId: "customer-1",
    version: 1,
    paymentStatus: "PAID",
    shipmentStatus: "NOT_STARTED",
    paidAmount: { currency: "KRW", amountMinor: 129000 },
  });
  const gateway = new ImmediateGateway();
  const service = new OrderCancellationService({ store, gateway });
  const server: Server = createServer(
    createRequestHandler({ service, publicDirectory, logger: () => undefined }),
  );

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    gateway,
    service,
    close: async () => {
      await service.drain();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function authHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: "Bearer customer-1",
    "X-Request-Id": randomUUID(),
    ...extra,
  };
}

test("runnable UI and health endpoint are served", async () => {
  const fixture = await startFixture();
  try {
    const page = await fetch(`${fixture.baseUrl}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Cancel an eligible order/);

    const health = await fetch(`${fixture.baseUrl}/health`);
    assert.deepEqual(await health.json(), { status: "ok" });
  } finally {
    await fixture.close();
  }
});

test("HTTP contract carries context, command receipt, and durable completion", async () => {
  const fixture = await startFixture();
  try {
    const contextResponse = await fetch(
      `${fixture.baseUrl}/orders/order-1001/cancellation-context`,
      { headers: authHeaders() },
    );
    assert.equal(contextResponse.status, 200);
    const context = await contextResponse.json();
    assert.equal(context.capability.allowed, true);

    const commandResponse = await fetch(
      `${fixture.baseUrl}/orders/order-1001/cancellations`,
      {
        method: "POST",
        headers: authHeaders({
          "Content-Type": "application/json",
          "Idempotency-Key": "http-idempotency-000001",
        }),
        body: JSON.stringify({
          reasonCode: "ORDERED_BY_MISTAKE",
          expectedVersion: context.orderVersion,
        }),
      },
    );
    assert.equal(commandResponse.status, 202);
    const location = commandResponse.headers.get("Location");
    assert.ok(location);
    const receipt = await commandResponse.json();
    assert.equal(receipt.status, "PENDING");

    await fixture.service.drain();
    const statusResponse = await fetch(`${fixture.baseUrl}${location}`, {
      headers: authHeaders(),
    });
    assert.equal(statusResponse.status, 200);
    const completed = await statusResponse.json();
    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.refund.amountMinor, 129000);
    assert.equal(fixture.gateway.calls, 1);
  } finally {
    await fixture.close();
  }
});

test("missing authentication and stale version use stable error envelopes", async () => {
  const fixture = await startFixture();
  try {
    const unauthenticated = await fetch(
      `${fixture.baseUrl}/orders/order-1001/cancellation-context`,
    );
    assert.equal(unauthenticated.status, 401);
    const authError = await unauthenticated.json();
    assert.equal(authError.code, "AUTHENTICATION_REQUIRED");
    assert.ok(authError.traceId);

    const stale = await fetch(`${fixture.baseUrl}/orders/order-1001/cancellations`, {
      method: "POST",
      headers: authHeaders({
        "Content-Type": "application/json",
        "Idempotency-Key": "http-idempotency-000002",
      }),
      body: JSON.stringify({
        reasonCode: "ORDERED_BY_MISTAKE",
        expectedVersion: 42,
      }),
    });
    assert.equal(stale.status, 409);
    const staleError = await stale.json();
    assert.equal(staleError.code, "ORDER_STATE_CONFLICT");
    assert.equal(staleError.details.currentVersion, 1);
  } finally {
    await fixture.close();
  }
});

test("concurrent distinct keys create at most one provider operation", async () => {
  const fixture = await startFixture();
  try {
    const makeRequest = (key: string) =>
      fetch(`${fixture.baseUrl}/orders/order-1001/cancellations`, {
        method: "POST",
        headers: authHeaders({
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        }),
        body: JSON.stringify({
          reasonCode: "DUPLICATE_ORDER",
          expectedVersion: 1,
        }),
      });

    const responses = await Promise.all([
      makeRequest("http-concurrent-key-0001"),
      makeRequest("http-concurrent-key-0002"),
    ]);
    const statuses = responses.map((response) => response.status).sort();
    assert.deepEqual(statuses, [202, 409]);

    await fixture.service.drain();
    assert.equal(fixture.gateway.calls, 1);
  } finally {
    await fixture.close();
  }
});

test("request evidence is structured, correlated, and excludes sensitive payload data", async () => {
  const store = new InMemoryCancellationStore(() => `cancel_${randomUUID()}`);
  store.seedOrder({
    id: "order-1001",
    customerId: "customer-1",
    version: 1,
    paymentStatus: "PAID",
    shipmentStatus: "NOT_STARTED",
    paidAmount: { currency: "KRW", amountMinor: 129000 },
  });
  const service = new OrderCancellationService({ store, gateway: new ImmediateGateway() });
  const events: LogEvent[] = [];
  const server: Server = createServer(
    createRequestHandler({
      service,
      publicDirectory,
      logger: (event) => events.push(event),
    }),
  );

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port");
  }

  try {
    const traceId = "trace-safe-log-0001";
    const response = await fetch(
      `http://127.0.0.1:${address.port}/orders/order-1001/cancellation-context`,
      {
        headers: {
          Authorization: "Bearer customer-1",
          "X-Request-Id": traceId,
        },
      },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-request-id"), traceId);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);

    assert.equal(events.length, 1);
    assert.deepEqual(Object.keys(events[0]!).sort(), [
      "durationMs",
      "event",
      "method",
      "route",
      "statusCode",
      "traceId",
    ]);
    assert.equal(events[0]!.traceId, traceId);
    assert.equal(events[0]!.route, "getOrderCancellationContext");
    assert.equal(JSON.stringify(events[0]).includes("customer-1"), false);
    assert.equal(JSON.stringify(events[0]).includes("Authorization"), false);
  } finally {
    await service.drain();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("browser pilot retains a durable operation reference across reloads", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(join(publicDirectory, "app.js"), "utf-8"),
  );
  assert.match(source, /localStorage\.setItem/);
  assert.match(source, /stackforge-atlas:cancellation/);
  assert.match(source, /Restoring cancellation outcome/);
  assert.match(source, /localStorage\.removeItem/);
  assert.match(source, /\/order-cancellations\//);
});
