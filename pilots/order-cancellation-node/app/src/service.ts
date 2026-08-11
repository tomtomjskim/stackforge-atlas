import { createHash, randomUUID } from "node:crypto";
import {
  cancellationReasonOptions,
  type CancellationContext,
  type CancellationReasonCode,
  type CancellationReceipt,
  type CancellationRequest,
  type FieldError,
} from "./types.ts";
import { InMemoryCancellationStore } from "./store.ts";

export class ApplicationError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly fieldErrors: FieldError[];
  readonly details: Record<string, unknown> | undefined;

  constructor(options: {
    statusCode: number;
    code: string;
    message: string;
    retryable?: boolean;
    fieldErrors?: FieldError[];
    details?: Record<string, unknown>;
  }) {
    super(options.message);
    this.name = "ApplicationError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.fieldErrors = options.fieldErrors ?? [];
    this.details = options.details;
  }
}

export type GatewayOutcome =
  | { status: "COMPLETED" }
  | { status: "FAILED"; outcomeCode: string };

export interface CancellationGateway {
  cancel(input: {
    cancellationId: string;
    orderId: string;
    amountMinor: number;
    currency: string;
  }): Promise<GatewayOutcome>;
}

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class DelayedSuccessGateway implements CancellationGateway {
  readonly #delayMs: number;

  constructor(delayMs = 700) {
    this.#delayMs = delayMs;
  }

  async cancel(): Promise<GatewayOutcome> {
    await new Promise<void>((resolve) => setTimeout(resolve, this.#delayMs));
    return { status: "COMPLETED" };
  }
}

function isReasonCode(value: unknown): value is CancellationReasonCode {
  return cancellationReasonOptions.some((option) => option.code === value);
}

function normalizeRequest(value: unknown): CancellationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationError({
      statusCode: 400,
      code: "VALIDATION_FAILED",
      message: "Request body must be a JSON object.",
      fieldErrors: [{ field: "$", code: "OBJECT_REQUIRED" }],
    });
  }

  const body = value as Record<string, unknown>;
  const fieldErrors: FieldError[] = [];
  const allowedFields = new Set(["reasonCode", "reasonDetail", "expectedVersion"]);

  for (const field of Object.keys(body)) {
    if (!allowedFields.has(field)) {
      fieldErrors.push({ field, code: "UNKNOWN_FIELD" });
    }
  }

  if (!isReasonCode(body.reasonCode)) {
    fieldErrors.push({ field: "reasonCode", code: "INVALID_REASON" });
  }

  if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
    fieldErrors.push({ field: "expectedVersion", code: "POSITIVE_INTEGER_REQUIRED" });
  }

  let reasonDetail: string | undefined;
  if (body.reasonDetail !== undefined) {
    if (typeof body.reasonDetail !== "string") {
      fieldErrors.push({ field: "reasonDetail", code: "STRING_REQUIRED" });
    } else {
      reasonDetail = body.reasonDetail.trim();
      if (reasonDetail.length > 500) {
        fieldErrors.push({ field: "reasonDetail", code: "MAX_LENGTH_500" });
      }
    }
  }

  if (body.reasonCode === "OTHER" && !reasonDetail) {
    fieldErrors.push({ field: "reasonDetail", code: "DETAIL_REQUIRED" });
  }

  if (fieldErrors.length > 0 || !isReasonCode(body.reasonCode)) {
    throw new ApplicationError({
      statusCode: 400,
      code: "VALIDATION_FAILED",
      message: "Cancellation request failed validation.",
      fieldErrors,
    });
  }

  const request: CancellationRequest = {
    reasonCode: body.reasonCode,
    expectedVersion: Number(body.expectedVersion),
  };
  if (reasonDetail) {
    request.reasonDetail = reasonDetail;
  }
  return request;
}

function fingerprintRequest(request: CancellationRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        reasonCode: request.reasonCode,
        reasonDetail: request.reasonDetail ?? null,
        expectedVersion: request.expectedVersion,
      }),
    )
    .digest("hex");
}

function validateIdempotencyKey(value: string | undefined): string {
  if (!value || value.length < 16 || value.length > 128) {
    throw new ApplicationError({
      statusCode: 400,
      code: "VALIDATION_FAILED",
      message: "A 16-128 character Idempotency-Key header is required.",
      fieldErrors: [{ field: "Idempotency-Key", code: "INVALID_IDEMPOTENCY_KEY" }],
    });
  }
  return value;
}

export class OrderCancellationService {
  readonly #store: InMemoryCancellationStore;
  readonly #gateway: CancellationGateway;
  readonly #clock: Clock;
  readonly #backgroundTasks = new Set<Promise<void>>();

  constructor(options: {
    store: InMemoryCancellationStore;
    gateway: CancellationGateway;
    clock?: Clock;
  }) {
    this.#store = options.store;
    this.#gateway = options.gateway;
    this.#clock = options.clock ?? new SystemClock();
  }

  getContext(actorId: string, orderId: string): CancellationContext {
    const order = this.#store.getOrder(orderId);
    if (!order || order.customerId !== actorId) {
      throw new ApplicationError({
        statusCode: 404,
        code: "RESOURCE_NOT_FOUND",
        message: "The requested order is unavailable.",
      });
    }

    let unavailableReasonCode: string | undefined;
    if (order.cancellationId) {
      unavailableReasonCode = "CANCELLATION_ALREADY_ACCEPTED";
    } else if (order.paymentStatus !== "PAID") {
      unavailableReasonCode = "PAYMENT_NOT_PAID";
    } else if (order.shipmentStatus !== "NOT_STARTED") {
      unavailableReasonCode = "SHIPMENT_ALREADY_STARTED";
    }

    const capability: CancellationContext["capability"] = {
      allowed: unavailableReasonCode === undefined,
    };
    if (unavailableReasonCode) {
      capability.unavailableReasonCode = unavailableReasonCode;
    }

    return {
      orderId: order.id,
      orderVersion: order.version,
      paymentStatus: order.paymentStatus,
      shipmentStatus: order.shipmentStatus,
      capability,
      reasonOptions: cancellationReasonOptions.map((option) => ({ ...option })),
      estimatedRefund: { ...order.paidAmount },
    };
  }

  requestCancellation(input: {
    actorId: string;
    orderId: string;
    idempotencyKey?: string;
    body: unknown;
    traceId?: string;
  }): CancellationReceipt {
    const request = normalizeRequest(input.body);
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    const traceId = input.traceId ?? randomUUID();
    const now = this.#clock.now().toISOString();

    const result = this.#store.beginCancellation({
      actorId: input.actorId,
      orderId: input.orderId,
      idempotencyKey,
      fingerprint: fingerprintRequest(request),
      request,
      traceId,
      now,
    });

    if (result.kind === "not_found") {
      throw new ApplicationError({
        statusCode: 404,
        code: "RESOURCE_NOT_FOUND",
        message: "The requested order is unavailable.",
      });
    }
    if (result.kind === "version_conflict") {
      throw new ApplicationError({
        statusCode: 409,
        code: "ORDER_STATE_CONFLICT",
        message: "The order changed while this page was open.",
        details: { currentVersion: result.currentVersion },
      });
    }
    if (result.kind === "not_cancellable") {
      throw new ApplicationError({
        statusCode: 409,
        code: "ORDER_NOT_CANCELLABLE",
        message: "The order is no longer eligible for self-service cancellation.",
        details: {
          reasonCode: result.reasonCode,
          cancellationId: result.cancellationId,
        },
      });
    }
    if (result.kind === "idempotency_conflict") {
      throw new ApplicationError({
        statusCode: 409,
        code: "ORDER_STATE_CONFLICT",
        message: "The idempotency key was already used for a different request.",
      });
    }

    if (result.kind === "created") {
      const order = this.#store.getOrder(result.cancellation.orderId);
      if (!order) {
        throw new Error("Accepted cancellation references a missing order");
      }

      const task = Promise.resolve()
        .then(() =>
          this.#gateway.cancel({
            cancellationId: result.cancellation.id,
            orderId: result.cancellation.orderId,
            amountMinor: order.paidAmount.amountMinor,
            currency: order.paidAmount.currency,
          }),
        )
        .then((outcome) => {
          const completedAt = this.#clock.now().toISOString();
          if (outcome.status === "COMPLETED") {
            this.#store.completeCancellation(result.cancellation.id, completedAt);
          } else {
            this.#store.failCancellation(
              result.cancellation.id,
              completedAt,
              outcome.outcomeCode,
            );
          }
        })
        .catch(() => {
          this.#store.failCancellation(
            result.cancellation.id,
            this.#clock.now().toISOString(),
            "PROVIDER_UNAVAILABLE",
          );
        });

      this.#backgroundTasks.add(task);
      void task.finally(() => this.#backgroundTasks.delete(task));
    }

    return this.#toReceipt(result.cancellation);
  }

  getCancellation(actorId: string, cancellationId: string): CancellationReceipt {
    const cancellation = this.#store.getCancellation(cancellationId);
    if (!cancellation || cancellation.customerId !== actorId) {
      throw new ApplicationError({
        statusCode: 404,
        code: "RESOURCE_NOT_FOUND",
        message: "The requested cancellation is unavailable.",
      });
    }
    return this.#toReceipt(cancellation);
  }

  async drain(): Promise<void> {
    await Promise.all([...this.#backgroundTasks]);
  }

  #toReceipt(
    record: Exclude<ReturnType<InMemoryCancellationStore["getCancellation"]>, undefined>,
  ): CancellationReceipt {
    const receipt: CancellationReceipt = {
      cancellationId: record.id,
      orderId: record.orderId,
      status: record.status,
      acceptedAt: record.acceptedAt,
      updatedAt: record.updatedAt,
      traceId: record.traceId,
    };
    if (record.outcomeCode) {
      receipt.outcomeCode = record.outcomeCode;
    }
    if (record.refund) {
      receipt.refund = { ...record.refund };
    }
    return receipt;
  }
}
