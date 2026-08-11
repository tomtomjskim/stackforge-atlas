import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withTransaction, type DatabasePool } from "./db.ts";
import {
  cancellationReasonOptions,
  type CancellationContext,
  type CancellationReasonCode,
  type CancellationReceipt,
  type CancellationRequest,
  type FieldError,
} from "./types.ts";

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

const requestFields = new Set(["reasonCode", "reasonDetail", "expectedVersion"]);

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

  for (const field of Object.keys(body)) {
    if (!requestFields.has(field)) {
      fieldErrors.push({ field, code: "UNKNOWN_FIELD" });
    }
  }

  if (!isReasonCode(body.reasonCode)) {
    fieldErrors.push({ field: "reasonCode", code: "INVALID_REASON" });
  }

  if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
    fieldErrors.push({
      field: "expectedVersion",
      code: "POSITIVE_INTEGER_REQUIRED",
    });
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

function validateIdempotencyKey(value: string | undefined): string {
  if (!value || value.length < 16 || value.length > 128) {
    throw new ApplicationError({
      statusCode: 400,
      code: "VALIDATION_FAILED",
      message: "A 16-128 character Idempotency-Key header is required.",
      fieldErrors: [{
        field: "Idempotency-Key",
        code: "INVALID_IDEMPOTENCY_KEY",
      }],
    });
  }
  return value;
}

function fingerprintRequest(orderId: string, request: CancellationRequest): string {
  return createHash("sha256")
    .update(JSON.stringify({
      orderId,
      reasonCode: request.reasonCode,
      reasonDetail: request.reasonDetail ?? null,
      expectedVersion: request.expectedVersion,
    }))
    .digest("hex");
}

interface OrderRow {
  id: string;
  customer_id: string;
  version: number;
  payment_status: "PAID" | "REFUND_PENDING" | "REFUNDED";
  shipment_status: "NOT_STARTED" | "PROCESSING" | "SHIPPED";
  currency: string;
  amount_minor: string;
  cancellation_id: string | null;
}

interface CancellationRow {
  id: string;
  order_id: string;
  customer_id: string;
  request_fingerprint: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  accepted_at: Date;
  updated_at: Date;
  outcome_code: string | null;
  refund_currency: string | null;
  refund_amount_minor: string | null;
  trace_id: string;
}

function receiptFromRow(row: CancellationRow): CancellationReceipt {
  const receipt: CancellationReceipt = {
    cancellationId: row.id,
    orderId: row.order_id,
    status: row.status,
    acceptedAt: row.accepted_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    traceId: row.trace_id,
  };
  if (row.outcome_code) {
    receipt.outcomeCode = row.outcome_code;
  }
  if (row.refund_currency && row.refund_amount_minor !== null) {
    receipt.refund = {
      currency: row.refund_currency,
      amountMinor: Number(row.refund_amount_minor),
    };
  }
  return receipt;
}

async function findIdempotentCancellation(
  client: PoolClient,
  actorId: string,
  idempotencyKey: string,
): Promise<CancellationRow | undefined> {
  const result = await client.query(
    `
      SELECT
        id,
        order_id,
        customer_id,
        request_fingerprint,
        status,
        accepted_at,
        updated_at,
        outcome_code,
        refund_currency,
        refund_amount_minor,
        trace_id
      FROM order_cancellations
      WHERE customer_id = $1
        AND idempotency_key = $2
      FOR UPDATE
    `,
    [actorId, idempotencyKey],
  );
  return result.rows[0] as CancellationRow | undefined;
}

function replayOrConflict(
  row: CancellationRow,
  fingerprint: string,
): CancellationReceipt {
  if (row.request_fingerprint !== fingerprint) {
    throw new ApplicationError({
      statusCode: 409,
      code: "ORDER_STATE_CONFLICT",
      message: "The idempotency key was already used for a different request.",
    });
  }
  return receiptFromRow(row);
}

export class PostgresOrderCancellationService {
  readonly #pool: DatabasePool;

  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async getContext(actorId: string, orderId: string): Promise<CancellationContext> {
    const result = await this.#pool.query(
      `
        SELECT
          id,
          customer_id,
          version,
          payment_status,
          shipment_status,
          currency,
          amount_minor,
          cancellation_id
        FROM orders
        WHERE id = $1
      `,
      [orderId],
    );
    const order = result.rows[0] as OrderRow | undefined;
    if (!order || order.customer_id !== actorId) {
      throw new ApplicationError({
        statusCode: 404,
        code: "RESOURCE_NOT_FOUND",
        message: "The requested order is unavailable.",
      });
    }

    let unavailableReasonCode: string | undefined;
    if (order.cancellation_id) {
      unavailableReasonCode = "CANCELLATION_ALREADY_ACCEPTED";
    } else if (order.payment_status !== "PAID") {
      unavailableReasonCode = "PAYMENT_NOT_PAID";
    } else if (order.shipment_status !== "NOT_STARTED") {
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
      paymentStatus: order.payment_status,
      shipmentStatus: order.shipment_status,
      capability,
      reasonOptions: cancellationReasonOptions.map((option) => ({ ...option })),
      estimatedRefund: {
        currency: order.currency,
        amountMinor: Number(order.amount_minor),
      },
    };
  }

  async requestCancellation(input: {
    actorId: string;
    orderId: string;
    idempotencyKey?: string;
    body: unknown;
    traceId?: string;
  }): Promise<CancellationReceipt> {
    const request = normalizeRequest(input.body);
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    const traceId = input.traceId ?? randomUUID();
    const fingerprint = fingerprintRequest(input.orderId, request);

    return withTransaction(this.#pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${input.actorId}:${idempotencyKey}`],
      );

      const existing = await findIdempotentCancellation(
        client,
        input.actorId,
        idempotencyKey,
      );
      if (existing) {
        return replayOrConflict(existing, fingerprint);
      }

      const orderResult = await client.query(
        `
          SELECT
            id,
            customer_id,
            version,
            payment_status,
            shipment_status,
            currency,
            amount_minor,
            cancellation_id
          FROM orders
          WHERE id = $1
          FOR UPDATE
        `,
        [input.orderId],
      );
      const order = orderResult.rows[0] as OrderRow | undefined;
      if (!order || order.customer_id !== input.actorId) {
        throw new ApplicationError({
          statusCode: 404,
          code: "RESOURCE_NOT_FOUND",
          message: "The requested order is unavailable.",
        });
      }

      if (order.version !== request.expectedVersion) {
        throw new ApplicationError({
          statusCode: 409,
          code: "ORDER_STATE_CONFLICT",
          message: "The order changed while this page was open.",
          details: { currentVersion: order.version },
        });
      }

      let unavailableReasonCode: string | undefined;
      if (order.cancellation_id) {
        unavailableReasonCode = "CANCELLATION_ALREADY_ACCEPTED";
      } else if (order.payment_status !== "PAID") {
        unavailableReasonCode = "PAYMENT_NOT_PAID";
      } else if (order.shipment_status !== "NOT_STARTED") {
        unavailableReasonCode = "SHIPMENT_ALREADY_STARTED";
      }
      if (unavailableReasonCode) {
        throw new ApplicationError({
          statusCode: 409,
          code: "ORDER_NOT_CANCELLABLE",
          message: "The order is no longer eligible for self-service cancellation.",
          details: {
            reasonCode: unavailableReasonCode,
            cancellationId: order.cancellation_id,
          },
        });
      }

      const cancellationId = `cancel_${randomUUID()}`;
      const eventId = `outbox_${randomUUID()}`;
      const acceptedAt = new Date();

      const inserted = await client.query(
        `
          INSERT INTO order_cancellations(
            id,
            order_id,
            customer_id,
            idempotency_key,
            request_fingerprint,
            reason_code,
            reason_detail,
            status,
            accepted_at,
            updated_at,
            trace_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8, $8, $9)
          RETURNING
            id,
            order_id,
            customer_id,
            request_fingerprint,
            status,
            accepted_at,
            updated_at,
            outcome_code,
            refund_currency,
            refund_amount_minor,
            trace_id
        `,
        [
          cancellationId,
          order.id,
          input.actorId,
          idempotencyKey,
          fingerprint,
          request.reasonCode,
          request.reasonDetail ?? null,
          acceptedAt,
          traceId,
        ],
      );

      await client.query(
        `
          UPDATE orders
          SET
            cancellation_id = $2,
            payment_status = 'REFUND_PENDING',
            version = version + 1,
            updated_at = clock_timestamp()
          WHERE id = $1
        `,
        [order.id, cancellationId],
      );

      await client.query(
        `
          INSERT INTO outbox_events(
            event_id,
            aggregate_type,
            aggregate_id,
            event_type,
            payload,
            available_at
          )
          VALUES (
            $1,
            'order_cancellation',
            $2,
            'order.cancellation.requested',
            jsonb_build_object(
              'cancellationId', $2,
              'orderId', $3,
              'customerId', $4,
              'amountMinor', $5::bigint,
              'currency', $6,
              'traceId', $7
            ),
            clock_timestamp()
          )
        `,
        [
          eventId,
          cancellationId,
          order.id,
          input.actorId,
          order.amount_minor,
          order.currency,
          traceId,
        ],
      );

      await client.query(
        `
          INSERT INTO audit_events(
            event_id,
            actor_type,
            actor_id,
            action,
            object_type,
            object_id,
            result,
            reason_code,
            trace_id,
            metadata
          )
          VALUES (
            $1,
            'CUSTOMER',
            $2,
            'ORDER_CANCELLATION_REQUESTED',
            'ORDER',
            $3,
            'ACCEPTED',
            $4,
            $5,
            jsonb_build_object('cancellationId', $6)
          )
        `,
        [
          `audit_requested_${cancellationId}`,
          input.actorId,
          order.id,
          request.reasonCode,
          traceId,
          cancellationId,
        ],
      );

      return receiptFromRow(inserted.rows[0] as CancellationRow);
    });
  }

  async getCancellation(
    actorId: string,
    cancellationId: string,
  ): Promise<CancellationReceipt> {
    const result = await this.#pool.query(
      `
        SELECT
          id,
          order_id,
          customer_id,
          request_fingerprint,
          status,
          accepted_at,
          updated_at,
          outcome_code,
          refund_currency,
          refund_amount_minor,
          trace_id
        FROM order_cancellations
        WHERE id = $1
          AND customer_id = $2
      `,
      [cancellationId, actorId],
    );
    const row = result.rows[0] as CancellationRow | undefined;
    if (!row) {
      throw new ApplicationError({
        statusCode: 404,
        code: "RESOURCE_NOT_FOUND",
        message: "The requested cancellation is unavailable.",
      });
    }
    return receiptFromRow(row);
  }
}
