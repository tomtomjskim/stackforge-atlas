import type {
  CancellationRecord,
  CancellationRequest,
  Money,
  OrderRecord,
} from "./types.ts";

interface IdempotencyRecord {
  fingerprint: string;
  cancellationId: string;
}

export type BeginCancellationResult =
  | { kind: "created"; cancellation: CancellationRecord }
  | { kind: "replay"; cancellation: CancellationRecord }
  | { kind: "not_found" }
  | { kind: "version_conflict"; currentVersion: number }
  | { kind: "not_cancellable"; reasonCode: string; cancellationId?: string }
  | { kind: "idempotency_conflict" };

export interface BeginCancellationInput {
  actorId: string;
  orderId: string;
  idempotencyKey: string;
  fingerprint: string;
  request: CancellationRequest;
  traceId: string;
  now: string;
}

function cloneMoney(value: Money): Money {
  return { currency: value.currency, amountMinor: value.amountMinor };
}

function cloneOrder(value: OrderRecord): OrderRecord {
  return {
    ...value,
    paidAmount: cloneMoney(value.paidAmount),
  };
}

function cloneCancellation(value: CancellationRecord): CancellationRecord {
  const cloned: CancellationRecord = { ...value };
  if (value.refund) {
    cloned.refund = cloneMoney(value.refund);
  }
  return cloned;
}

export class InMemoryCancellationStore {
  readonly #orders = new Map<string, OrderRecord>();
  readonly #cancellations = new Map<string, CancellationRecord>();
  readonly #idempotency = new Map<string, IdempotencyRecord>();
  readonly #idFactory: () => string;

  constructor(idFactory: () => string) {
    this.#idFactory = idFactory;
  }

  seedOrder(order: OrderRecord): void {
    this.#orders.set(order.id, cloneOrder(order));
  }

  getOrder(orderId: string): OrderRecord | undefined {
    const order = this.#orders.get(orderId);
    return order ? cloneOrder(order) : undefined;
  }

  getCancellation(cancellationId: string): CancellationRecord | undefined {
    const cancellation = this.#cancellations.get(cancellationId);
    return cancellation ? cloneCancellation(cancellation) : undefined;
  }

  beginCancellation(input: BeginCancellationInput): BeginCancellationResult {
    const scope = `${input.actorId}:${input.orderId}:${input.idempotencyKey}`;
    const existingIdempotency = this.#idempotency.get(scope);

    if (existingIdempotency) {
      if (existingIdempotency.fingerprint !== input.fingerprint) {
        return { kind: "idempotency_conflict" };
      }
      const existing = this.#cancellations.get(existingIdempotency.cancellationId);
      if (!existing) {
        throw new Error("Idempotency record references a missing cancellation");
      }
      return { kind: "replay", cancellation: cloneCancellation(existing) };
    }

    const order = this.#orders.get(input.orderId);
    if (!order || order.customerId !== input.actorId) {
      return { kind: "not_found" };
    }

    if (order.version !== input.request.expectedVersion) {
      return { kind: "version_conflict", currentVersion: order.version };
    }

    if (order.cancellationId) {
      return {
        kind: "not_cancellable",
        reasonCode: "CANCELLATION_ALREADY_ACCEPTED",
        cancellationId: order.cancellationId,
      };
    }

    if (order.paymentStatus !== "PAID") {
      return { kind: "not_cancellable", reasonCode: "PAYMENT_NOT_PAID" };
    }

    if (order.shipmentStatus !== "NOT_STARTED") {
      return { kind: "not_cancellable", reasonCode: "SHIPMENT_ALREADY_STARTED" };
    }

    const cancellationId = this.#idFactory();
    const cancellation: CancellationRecord = {
      id: cancellationId,
      orderId: order.id,
      customerId: input.actorId,
      reasonCode: input.request.reasonCode,
      status: "PENDING",
      acceptedAt: input.now,
      updatedAt: input.now,
      traceId: input.traceId,
    };
    if (input.request.reasonDetail) {
      cancellation.reasonDetail = input.request.reasonDetail;
    }

    order.paymentStatus = "REFUND_PENDING";
    order.cancellationId = cancellationId;
    order.version += 1;

    this.#orders.set(order.id, order);
    this.#cancellations.set(cancellationId, cancellation);
    this.#idempotency.set(scope, {
      fingerprint: input.fingerprint,
      cancellationId,
    });

    return { kind: "created", cancellation: cloneCancellation(cancellation) };
  }

  completeCancellation(cancellationId: string, now: string): void {
    const cancellation = this.#cancellations.get(cancellationId);
    if (!cancellation || cancellation.status !== "PENDING") {
      return;
    }

    const order = this.#orders.get(cancellation.orderId);
    if (!order || order.cancellationId !== cancellationId) {
      throw new Error("Cancellation and order state diverged");
    }

    cancellation.status = "COMPLETED";
    cancellation.updatedAt = now;
    cancellation.outcomeCode = "REFUND_COMPLETED";
    cancellation.refund = cloneMoney(order.paidAmount);

    order.paymentStatus = "REFUNDED";
    order.version += 1;

    this.#cancellations.set(cancellationId, cancellation);
    this.#orders.set(order.id, order);
  }

  failCancellation(cancellationId: string, now: string, outcomeCode: string): void {
    const cancellation = this.#cancellations.get(cancellationId);
    if (!cancellation || cancellation.status !== "PENDING") {
      return;
    }

    const order = this.#orders.get(cancellation.orderId);
    if (!order || order.cancellationId !== cancellationId) {
      throw new Error("Cancellation and order state diverged");
    }

    cancellation.status = "FAILED";
    cancellation.updatedAt = now;
    cancellation.outcomeCode = outcomeCode;

    order.paymentStatus = "PAID";
    delete order.cancellationId;
    order.version += 1;

    this.#cancellations.set(cancellationId, cancellation);
    this.#orders.set(order.id, order);
  }
}
