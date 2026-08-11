import assert from "node:assert/strict";
import test from "node:test";
import {
  ApplicationError,
  OrderCancellationService,
  type CancellationGateway,
  type GatewayOutcome,
} from "../src/service.ts";
import { InMemoryCancellationStore } from "../src/store.ts";

class FixedClock {
  #tick = 0;

  now(): Date {
    this.#tick += 1;
    return new Date(Date.UTC(2026, 7, 11, 6, 0, this.#tick));
  }
}

class DeferredGateway implements CancellationGateway {
  calls = 0;
  #resolve?: (outcome: GatewayOutcome) => void;

  cancel(): Promise<GatewayOutcome> {
    this.calls += 1;
    return new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  complete(): void {
    this.#resolve?.({ status: "COMPLETED" });
  }
}

function fixture() {
  let nextId = 0;
  const store = new InMemoryCancellationStore(() => `cancel-${++nextId}`);
  store.seedOrder({
    id: "order-1001",
    customerId: "customer-1",
    version: 1,
    paymentStatus: "PAID",
    shipmentStatus: "NOT_STARTED",
    paidAmount: { currency: "KRW", amountMinor: 129000 },
  });
  const gateway = new DeferredGateway();
  const service = new OrderCancellationService({
    store,
    gateway,
    clock: new FixedClock(),
  });
  return { store, gateway, service };
}

const validBody = {
  reasonCode: "ORDERED_BY_MISTAKE",
  expectedVersion: 1,
};

test("context is permission-safe and exposes authoritative capability", () => {
  const { service } = fixture();
  const context = service.getContext("customer-1", "order-1001");
  assert.equal(context.capability.allowed, true);
  assert.equal(context.orderVersion, 1);
  assert.equal(context.estimatedRefund.amountMinor, 129000);

  assert.throws(
    () => service.getContext("customer-2", "order-1001"),
    (error: unknown) =>
      error instanceof Error &&
      "statusCode" in error &&
      error.statusCode === 404,
  );
});

test("same idempotency key replays while a changed payload conflicts", async () => {
  const { gateway, service } = fixture();
  const first = service.requestCancellation({
    actorId: "customer-1",
    orderId: "order-1001",
    idempotencyKey: "idem-order-1001-0001",
    body: validBody,
    traceId: "trace-first",
  });
  const replay = service.requestCancellation({
    actorId: "customer-1",
    orderId: "order-1001",
    idempotencyKey: "idem-order-1001-0001",
    body: validBody,
    traceId: "trace-retry",
  });

  assert.equal(replay.cancellationId, first.cancellationId);
  assert.equal(replay.traceId, "trace-first");

  assert.throws(
    () =>
      service.requestCancellation({
        actorId: "customer-1",
        orderId: "order-1001",
        idempotencyKey: "idem-order-1001-0001",
        body: { ...validBody, reasonCode: "DUPLICATE_ORDER" },
      }),
    (error: unknown) =>
      error instanceof Error && "statusCode" in error && error.statusCode === 409,
  );

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(gateway.calls, 1);
  gateway.complete();
  await service.drain();
});

test("distinct keys cannot bypass the protected cancellation transition", async () => {
  const { gateway, service } = fixture();
  const accepted = service.requestCancellation({
    actorId: "customer-1",
    orderId: "order-1001",
    idempotencyKey: "idem-order-1001-0001",
    body: validBody,
  });

  assert.throws(
    () =>
      service.requestCancellation({
        actorId: "customer-1",
        orderId: "order-1001",
        idempotencyKey: "idem-order-1001-0002",
        body: validBody,
      }),
    (error: unknown) =>
      error instanceof Error && "statusCode" in error && error.statusCode === 409,
  );

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(gateway.calls, 1);
  gateway.complete();
  await service.drain();

  const completed = service.getCancellation("customer-1", accepted.cancellationId);
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.refund?.amountMinor, 129000);
});

test("stale order version is rejected before the provider is called", async () => {
  const { gateway, service } = fixture();

  assert.throws(
    () =>
      service.requestCancellation({
        actorId: "customer-1",
        orderId: "order-1001",
        idempotencyKey: "idem-order-1001-0001",
        body: { ...validBody, expectedVersion: 99 },
      }),
    (error: unknown) =>
      error instanceof Error && "statusCode" in error && error.statusCode === 409,
  );

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(gateway.calls, 0);
});

test("request rejects fields outside the closed OpenAPI schema", () => {
  const { gateway, service } = fixture();

  assert.throws(
    () =>
      service.requestCancellation({
        actorId: "customer-1",
        orderId: "order-1001",
        idempotencyKey: "idem-order-1001-0001",
        body: { ...validBody, unexpectedField: true },
      }),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.statusCode === 400 &&
      error.fieldErrors.some(
        (fieldError) =>
          fieldError.field === "unexpectedField" &&
          fieldError.code === "UNKNOWN_FIELD",
      ),
  );
  assert.equal(gateway.calls, 0);
});

test("drain waits for every accepted provider task", async () => {
  const { gateway, service } = fixture();
  service.requestCancellation({
    actorId: "customer-1",
    orderId: "order-1001",
    idempotencyKey: "idem-order-1001-0001",
    body: validBody,
  });

  let drained = false;
  const draining = service.drain().then(() => {
    drained = true;
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(gateway.calls, 1);
  assert.equal(drained, false);

  gateway.complete();
  await draining;
  assert.equal(drained, true);
});
