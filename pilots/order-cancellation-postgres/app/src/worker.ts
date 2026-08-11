import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withTransaction, type DatabasePool } from "./db.ts";
import type { OutboxEvent } from "./types.ts";

export type ProviderOutcome =
  | { status: "COMPLETED"; providerReference: string }
  | { status: "FAILED"; outcomeCode: string; providerReference: string };

export interface CancellationProviderGateway {
  cancel(input: OutboxEvent["payload"]): Promise<ProviderOutcome>;
}

interface OutboxRow {
  id: string;
  event_id: string;
  event_type: "order.cancellation.requested";
  aggregate_id: string;
  payload: OutboxEvent["payload"];
  attempts: number;
  locked_by: string;
}

function mapOutboxRow(row: OutboxRow): OutboxEvent {
  return {
    id: Number(row.id),
    eventId: row.event_id,
    eventType: row.event_type,
    aggregateId: row.aggregate_id,
    payload: row.payload,
    attempts: row.attempts,
    lockedBy: row.locked_by,
  };
}

export class PostgresIdempotentProviderGateway
  implements CancellationProviderGateway {
  readonly #pool: DatabasePool;

  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async cancel(input: OutboxEvent["payload"]): Promise<ProviderOutcome> {
    const providerReference = `provider_${input.cancellationId}`;
    const result = await this.#pool.query(
      `
        INSERT INTO provider_cancellation_effects(
          cancellation_id,
          provider_reference,
          status,
          call_count,
          created_at,
          last_seen_at
        )
        VALUES ($1, $2, 'COMPLETED', 1, clock_timestamp(), clock_timestamp())
        ON CONFLICT (cancellation_id)
        DO UPDATE SET
          call_count = provider_cancellation_effects.call_count + 1,
          last_seen_at = clock_timestamp()
        RETURNING status, outcome_code, provider_reference
      `,
      [input.cancellationId, providerReference],
    );
    const row = result.rows[0] as {
      status: "COMPLETED" | "FAILED";
      outcome_code: string | null;
      provider_reference: string;
    };
    if (row.status === "FAILED") {
      return {
        status: "FAILED",
        outcomeCode: row.outcome_code ?? "PROVIDER_REJECTED",
        providerReference: row.provider_reference,
      };
    }
    return {
      status: "COMPLETED",
      providerReference: row.provider_reference,
    };
  }
}

export class PostgresOutboxWorker {
  readonly #pool: DatabasePool;
  readonly #gateway: CancellationProviderGateway;
  readonly #workerId: string;
  readonly #leaseSeconds: number;
  readonly #maxAttempts: number;

  constructor(options: {
    pool: DatabasePool;
    gateway: CancellationProviderGateway;
    workerId?: string;
    leaseSeconds?: number;
    maxAttempts?: number;
  }) {
    this.#pool = options.pool;
    this.#gateway = options.gateway;
    this.#workerId = options.workerId ?? `worker_${randomUUID()}`;
    this.#leaseSeconds = options.leaseSeconds ?? 30;
    this.#maxAttempts = options.maxAttempts ?? 5;
  }

  async claimNext(): Promise<OutboxEvent | undefined> {
    return withTransaction(this.#pool, async (client) => {
      const result = await client.query(
        `
          WITH candidate AS (
            SELECT id
            FROM outbox_events
            WHERE published_at IS NULL
              AND available_at <= clock_timestamp()
              AND (
                locked_at IS NULL
                OR locked_at < clock_timestamp() - ($1::integer * interval '1 second')
              )
            ORDER BY id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          UPDATE outbox_events AS event
          SET
            locked_by = $2,
            locked_at = clock_timestamp(),
            attempts = event.attempts + 1,
            updated_at = clock_timestamp()
          FROM candidate
          WHERE event.id = candidate.id
          RETURNING
            event.id,
            event.event_id,
            event.event_type,
            event.aggregate_id,
            event.payload,
            event.attempts,
            event.locked_by
        `,
        [this.#leaseSeconds, this.#workerId],
      );
      const row = result.rows[0] as OutboxRow | undefined;
      return row ? mapOutboxRow(row) : undefined;
    });
  }

  async runOnce(): Promise<
    "idle" | "completed" | "failed" | "retry_scheduled" | "lease_lost"
  > {
    const event = await this.claimNext();
    if (!event) {
      return "idle";
    }

    try {
      const outcome = await this.#gateway.cancel(event.payload);
      return await this.#finalize(event, outcome);
    } catch (error) {
      return await this.#scheduleRetry(
        event,
        error instanceof Error ? error.message : "Unknown provider error",
      );
    }
  }

  async #finalize(
    event: OutboxEvent,
    outcome: ProviderOutcome,
  ): Promise<"completed" | "failed" | "lease_lost"> {
    return withTransaction(this.#pool, async (client) => {
      const owned = await this.#lockOwnedEvent(client, event);
      if (!owned) {
        return "lease_lost";
      }

      const cancellationResult = await client.query(
        `
          SELECT
            id,
            order_id,
            customer_id,
            status,
            trace_id
          FROM order_cancellations
          WHERE id = $1
          FOR UPDATE
        `,
        [event.payload.cancellationId],
      );
      const cancellation = cancellationResult.rows[0] as
        | {
            id: string;
            order_id: string;
            customer_id: string;
            status: "PENDING" | "COMPLETED" | "FAILED";
            trace_id: string;
          }
        | undefined;
      if (!cancellation) {
        throw new Error("Outbox event references a missing cancellation");
      }

      if (outcome.status === "COMPLETED") {
        if (cancellation.status === "PENDING") {
          await client.query(
            `
              UPDATE order_cancellations
              SET
                status = 'COMPLETED',
                outcome_code = 'PROVIDER_COMPLETED',
                refund_currency = $2,
                refund_amount_minor = $3,
                updated_at = clock_timestamp()
              WHERE id = $1
            `,
            [
              cancellation.id,
              event.payload.currency,
              event.payload.amountMinor,
            ],
          );
          await client.query(
            `
              UPDATE orders
              SET
                payment_status = 'REFUNDED',
                version = version + 1,
                updated_at = clock_timestamp()
              WHERE id = $1
                AND cancellation_id = $2
            `,
            [cancellation.order_id, cancellation.id],
          );
          await this.#insertAudit(client, {
            eventId: `audit_completed_${cancellation.id}`,
            actorType: "SYSTEM",
            actorId: this.#workerId,
            action: "ORDER_CANCELLATION_COMPLETED",
            objectId: cancellation.order_id,
            result: "COMPLETED",
            reasonCode: "PROVIDER_COMPLETED",
            traceId: cancellation.trace_id,
            cancellationId: cancellation.id,
            providerReference: outcome.providerReference,
          });
        }

        await this.#markPublished(client, event.id);
        return "completed";
      }

      if (cancellation.status === "PENDING") {
        await client.query(
          `
            UPDATE order_cancellations
            SET
              status = 'FAILED',
              outcome_code = $2,
              updated_at = clock_timestamp()
            WHERE id = $1
          `,
          [cancellation.id, outcome.outcomeCode],
        );
        await client.query(
          `
            UPDATE orders
            SET
              payment_status = 'PAID',
              cancellation_id = NULL,
              version = version + 1,
              updated_at = clock_timestamp()
            WHERE id = $1
              AND cancellation_id = $2
          `,
          [cancellation.order_id, cancellation.id],
        );
        await this.#insertAudit(client, {
          eventId: `audit_failed_${cancellation.id}`,
          actorType: "SYSTEM",
          actorId: this.#workerId,
          action: "ORDER_CANCELLATION_FAILED",
          objectId: cancellation.order_id,
          result: "FAILED",
          reasonCode: outcome.outcomeCode,
          traceId: cancellation.trace_id,
          cancellationId: cancellation.id,
          providerReference: outcome.providerReference,
        });
      }

      await this.#markPublished(client, event.id);
      return "failed";
    });
  }

  async #scheduleRetry(
    event: OutboxEvent,
    message: string,
  ): Promise<"retry_scheduled" | "failed" | "lease_lost"> {
    return withTransaction(this.#pool, async (client) => {
      const owned = await this.#lockOwnedEvent(client, event);
      if (!owned) {
        return "lease_lost";
      }

      if (event.attempts < this.#maxAttempts) {
        const delaySeconds = Math.min(60, 2 ** Math.max(0, event.attempts - 1));
        await client.query(
          `
            UPDATE outbox_events
            SET
              available_at = clock_timestamp() + ($2::integer * interval '1 second'),
              locked_by = NULL,
              locked_at = NULL,
              last_error = $3,
              updated_at = clock_timestamp()
            WHERE id = $1
          `,
          [event.id, delaySeconds, message.slice(0, 500)],
        );
        return "retry_scheduled";
      }

      const cancellationResult = await client.query(
        `
          SELECT id, order_id, trace_id, status
          FROM order_cancellations
          WHERE id = $1
          FOR UPDATE
        `,
        [event.payload.cancellationId],
      );
      const cancellation = cancellationResult.rows[0] as
        | {
            id: string;
            order_id: string;
            trace_id: string;
            status: "PENDING" | "COMPLETED" | "FAILED";
          }
        | undefined;
      if (!cancellation) {
        throw new Error("Outbox event references a missing cancellation");
      }

      if (cancellation.status === "PENDING") {
        await client.query(
          `
            UPDATE order_cancellations
            SET
              status = 'FAILED',
              outcome_code = 'PROVIDER_RETRY_EXHAUSTED',
              updated_at = clock_timestamp()
            WHERE id = $1
          `,
          [cancellation.id],
        );
        await client.query(
          `
            UPDATE orders
            SET
              payment_status = 'PAID',
              cancellation_id = NULL,
              version = version + 1,
              updated_at = clock_timestamp()
            WHERE id = $1
              AND cancellation_id = $2
          `,
          [cancellation.order_id, cancellation.id],
        );
        await this.#insertAudit(client, {
          eventId: `audit_failed_${cancellation.id}`,
          actorType: "SYSTEM",
          actorId: this.#workerId,
          action: "ORDER_CANCELLATION_FAILED",
          objectId: cancellation.order_id,
          result: "FAILED",
          reasonCode: "PROVIDER_RETRY_EXHAUSTED",
          traceId: cancellation.trace_id,
          cancellationId: cancellation.id,
        });
      }

      await client.query(
        `
          UPDATE outbox_events
          SET
            published_at = clock_timestamp(),
            locked_by = NULL,
            locked_at = NULL,
            last_error = $2,
            updated_at = clock_timestamp()
          WHERE id = $1
        `,
        [event.id, message.slice(0, 500)],
      );
      return "failed";
    });
  }

  async #lockOwnedEvent(
    client: PoolClient,
    event: OutboxEvent,
  ): Promise<boolean> {
    const result = await client.query(
      `
        SELECT id, locked_by, published_at
        FROM outbox_events
        WHERE id = $1
        FOR UPDATE
      `,
      [event.id],
    );
    const row = result.rows[0] as
      | { id: string; locked_by: string | null; published_at: Date | null }
      | undefined;
    return Boolean(
      row &&
        row.published_at === null &&
        row.locked_by === this.#workerId,
    );
  }

  async #markPublished(client: PoolClient, eventId: number): Promise<void> {
    await client.query(
      `
        UPDATE outbox_events
        SET
          published_at = clock_timestamp(),
          locked_by = NULL,
          locked_at = NULL,
          last_error = NULL,
          updated_at = clock_timestamp()
        WHERE id = $1
      `,
      [eventId],
    );
  }

  async #insertAudit(
    client: PoolClient,
    input: {
      eventId: string;
      actorType: string;
      actorId: string;
      action: string;
      objectId: string;
      result: string;
      reasonCode: string;
      traceId: string;
      cancellationId: string;
      providerReference?: string;
    },
  ): Promise<void> {
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
          $2,
          $3,
          $4,
          'ORDER',
          $5,
          $6,
          $7,
          $8,
          jsonb_strip_nulls(
            jsonb_build_object(
              'cancellationId', $9,
              'providerReference', $10::text
            )
          )
        )
        ON CONFLICT (event_id) DO NOTHING
      `,
      [
        input.eventId,
        input.actorType,
        input.actorId,
        input.action,
        input.objectId,
        input.result,
        input.reasonCode,
        input.traceId,
        input.cancellationId,
        input.providerReference ?? null,
      ],
    );
  }
}
