import type { PoolClient } from "pg";
import { withTransaction, type DatabasePool } from "./db.ts";
import { ApplicationError } from "./service.ts";

export type ReconciliationResolution = "COMPLETED" | "FAILED";
export type ReconciliationCaseStatus =
  | "OPEN"
  | "RESOLVED_COMPLETED"
  | "RESOLVED_FAILED";

interface ReconciliationCaseRow {
  id: string;
  cancellation_id: string;
  outbox_event_id: string;
  status: ReconciliationCaseStatus;
  reason_code: string;
  provider_reference: string | null;
  resolution_note: string | null;
  opened_at: Date;
  resolved_at: Date | null;
  resolved_by: string | null;
  updated_at: Date;
}

interface CancellationRow {
  id: string;
  order_id: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  trace_id: string;
}

interface OutboxRow {
  id: string;
  payload: {
    cancellationId: string;
    orderId: string;
    customerId: string;
    amountMinor: number;
    currency: string;
    traceId: string;
  };
  published_at: Date | null;
  reconciliation_required_at: Date | null;
}

export interface ReconciliationCase {
  caseId: number;
  cancellationId: string;
  outboxEventId: number;
  status: ReconciliationCaseStatus;
  reasonCode: string;
  providerReference?: string;
  resolutionNote?: string;
  openedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  updatedAt: string;
}

export interface OperationalHealth {
  pendingCancellations: number;
  readyOutboxEvents: number;
  expiredWorkerLeases: number;
  openReconciliationCases: number;
  oldestPendingSeconds: number;
}

function mapCase(row: ReconciliationCaseRow): ReconciliationCase {
  const result: ReconciliationCase = {
    caseId: Number(row.id),
    cancellationId: row.cancellation_id,
    outboxEventId: Number(row.outbox_event_id),
    status: row.status,
    reasonCode: row.reason_code,
    openedAt: row.opened_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
  if (row.provider_reference) {
    result.providerReference = row.provider_reference;
  }
  if (row.resolution_note) {
    result.resolutionNote = row.resolution_note;
  }
  if (row.resolved_at) {
    result.resolvedAt = row.resolved_at.toISOString();
  }
  if (row.resolved_by) {
    result.resolvedBy = row.resolved_by;
  }
  return result;
}

function validateActor(value: string): string {
  const actor = value.trim();
  if (!/^[A-Za-z0-9._-]{3,80}$/.test(actor)) {
    throw new ApplicationError({
      statusCode: 400,
      code: "VALIDATION_FAILED",
      message: "A valid reconciliation actor is required.",
    });
  }
  return actor;
}

function validateNote(value: string | undefined): string | undefined {
  const note = value?.trim();
  if (!note) {
    return undefined;
  }
  if (note.length > 500) {
    throw new ApplicationError({
      statusCode: 400,
      code: "VALIDATION_FAILED",
      message: "Reconciliation notes must not exceed 500 characters.",
    });
  }
  return note;
}

function validateProviderReference(
  resolution: ReconciliationResolution,
  value: string | undefined,
): string | undefined {
  const providerReference = value?.trim();
  if (resolution === "COMPLETED" && !providerReference) {
    throw new ApplicationError({
      statusCode: 400,
      code: "VALIDATION_FAILED",
      message: "A provider reference is required for completed reconciliation.",
    });
  }
  if (providerReference && providerReference.length > 160) {
    throw new ApplicationError({
      statusCode: 400,
      code: "VALIDATION_FAILED",
      message: "Provider references must not exceed 160 characters.",
    });
  }
  return providerReference;
}

async function lockCase(
  client: PoolClient,
  caseId: number,
): Promise<ReconciliationCaseRow> {
  const result = await client.query(
    `
      SELECT
        id,
        cancellation_id,
        outbox_event_id,
        status,
        reason_code,
        provider_reference,
        resolution_note,
        opened_at,
        resolved_at,
        resolved_by,
        updated_at
      FROM reconciliation_cases
      WHERE id = $1
      FOR UPDATE
    `,
    [caseId],
  );
  const row = result.rows[0] as ReconciliationCaseRow | undefined;
  if (!row) {
    throw new ApplicationError({
      statusCode: 404,
      code: "RESOURCE_NOT_FOUND",
      message: "The reconciliation case does not exist.",
    });
  }
  return row;
}

export class PostgresReconciliationService {
  readonly #pool: DatabasePool;

  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  async listOpen(limit = 50): Promise<ReconciliationCase[]> {
    const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    const result = await this.#pool.query(
      `
        SELECT
          id,
          cancellation_id,
          outbox_event_id,
          status,
          reason_code,
          provider_reference,
          resolution_note,
          opened_at,
          resolved_at,
          resolved_by,
          updated_at
        FROM reconciliation_cases
        WHERE status = 'OPEN'
        ORDER BY opened_at, id
        LIMIT $1
      `,
      [boundedLimit],
    );
    return (result.rows as ReconciliationCaseRow[]).map(mapCase);
  }

  async getHealth(): Promise<OperationalHealth> {
    const result = await this.#pool.query(`
      SELECT
        pending_cancellations,
        ready_outbox_events,
        expired_worker_leases,
        open_reconciliation_cases,
        oldest_pending_seconds
      FROM operational_recovery_health
    `);
    const row = result.rows[0] as
      | {
          pending_cancellations: string;
          ready_outbox_events: string;
          expired_worker_leases: string;
          open_reconciliation_cases: string;
          oldest_pending_seconds: string;
        }
      | undefined;
    if (!row) {
      throw new Error("Operational health view returned no row");
    }
    return {
      pendingCancellations: Number(row.pending_cancellations),
      readyOutboxEvents: Number(row.ready_outbox_events),
      expiredWorkerLeases: Number(row.expired_worker_leases),
      openReconciliationCases: Number(row.open_reconciliation_cases),
      oldestPendingSeconds: Number(row.oldest_pending_seconds),
    };
  }

  async resolve(input: {
    caseId: number;
    actorId: string;
    resolution: ReconciliationResolution;
    providerReference?: string;
    note?: string;
  }): Promise<ReconciliationCase> {
    if (!Number.isSafeInteger(input.caseId) || input.caseId < 1) {
      throw new ApplicationError({
        statusCode: 400,
        code: "VALIDATION_FAILED",
        message: "A positive reconciliation case ID is required.",
      });
    }
    const actorId = validateActor(input.actorId);
    const note = validateNote(input.note);
    const providerReference = validateProviderReference(
      input.resolution,
      input.providerReference,
    );
    const targetStatus: ReconciliationCaseStatus =
      input.resolution === "COMPLETED"
        ? "RESOLVED_COMPLETED"
        : "RESOLVED_FAILED";

    return withTransaction(this.#pool, async (client) => {
      const caseRow = await lockCase(client, input.caseId);
      if (caseRow.status !== "OPEN") {
        if (caseRow.status === targetStatus) {
          return mapCase(caseRow);
        }
        throw new ApplicationError({
          statusCode: 409,
          code: "RECONCILIATION_ALREADY_RESOLVED",
          message: "The reconciliation case was resolved with a different outcome.",
        });
      }

      const cancellationResult = await client.query(
        `
          SELECT id, order_id, status, trace_id
          FROM order_cancellations
          WHERE id = $1
          FOR UPDATE
        `,
        [caseRow.cancellation_id],
      );
      const cancellation = cancellationResult.rows[0] as
        | CancellationRow
        | undefined;
      if (!cancellation) {
        throw new Error("Reconciliation case references a missing cancellation");
      }
      if (cancellation.status !== "PENDING") {
        throw new ApplicationError({
          statusCode: 409,
          code: "ORDER_STATE_CONFLICT",
          message: "The cancellation is no longer pending reconciliation.",
        });
      }

      const outboxResult = await client.query(
        `
          SELECT id, payload, published_at, reconciliation_required_at
          FROM outbox_events
          WHERE id = $1
          FOR UPDATE
        `,
        [caseRow.outbox_event_id],
      );
      const outbox = outboxResult.rows[0] as OutboxRow | undefined;
      if (!outbox || !outbox.reconciliation_required_at || outbox.published_at) {
        throw new ApplicationError({
          statusCode: 409,
          code: "ORDER_STATE_CONFLICT",
          message: "The outbox event is not awaiting reconciliation.",
        });
      }

      await client.query(
        "SELECT id FROM orders WHERE id = $1 FOR UPDATE",
        [cancellation.order_id],
      );

      if (input.resolution === "COMPLETED") {
        await client.query(
          `
            UPDATE order_cancellations
            SET
              status = 'COMPLETED',
              outcome_code = 'RECONCILED_PROVIDER_COMPLETED',
              refund_currency = $2,
              refund_amount_minor = $3,
              updated_at = clock_timestamp()
            WHERE id = $1
          `,
          [
            cancellation.id,
            outbox.payload.currency,
            outbox.payload.amountMinor,
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
      } else {
        await client.query(
          `
            UPDATE order_cancellations
            SET
              status = 'FAILED',
              outcome_code = 'RECONCILED_PROVIDER_FAILED',
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
      }

      await client.query(
        `
          UPDATE outbox_events
          SET
            published_at = clock_timestamp(),
            locked_by = NULL,
            locked_at = NULL,
            updated_at = clock_timestamp()
          WHERE id = $1
        `,
        [caseRow.outbox_event_id],
      );

      const updated = await client.query(
        `
          UPDATE reconciliation_cases
          SET
            status = $2,
            provider_reference = $3,
            resolution_note = $4,
            resolved_at = clock_timestamp(),
            resolved_by = $5,
            updated_at = clock_timestamp()
          WHERE id = $1
          RETURNING
            id,
            cancellation_id,
            outbox_event_id,
            status,
            reason_code,
            provider_reference,
            resolution_note,
            opened_at,
            resolved_at,
            resolved_by,
            updated_at
        `,
        [input.caseId, targetStatus, providerReference ?? null, note ?? null, actorId],
      );

      const metadata = JSON.stringify({
        reconciliationCaseId: input.caseId,
        cancellationId: cancellation.id,
        resolution: input.resolution,
        ...(providerReference ? { providerReference } : {}),
      });
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
            'OPERATOR',
            $2,
            'ORDER_CANCELLATION_RECONCILED',
            'ORDER',
            $3,
            $4,
            $5,
            $6,
            $7::jsonb
          )
          ON CONFLICT (event_id) DO NOTHING
        `,
        [
          `audit_reconciled_${input.caseId}`,
          actorId,
          cancellation.order_id,
          input.resolution,
          targetStatus,
          cancellation.trace_id,
          metadata,
        ],
      );

      return mapCase(updated.rows[0] as ReconciliationCaseRow);
    });
  }
}
