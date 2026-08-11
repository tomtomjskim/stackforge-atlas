import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabasePool, waitForDatabase } from "./db.ts";
import { migrate } from "./migrate.ts";
import {
  PostgresReconciliationService,
  type ReconciliationResolution,
} from "./reconciliation.ts";
import { seedOrder } from "./seed.ts";
import { PostgresOrderCancellationService } from "./service.ts";
import {
  PostgresIdempotentProviderGateway,
  PostgresOutboxWorker,
  type CancellationProviderGateway,
} from "./worker.ts";

function options(argv: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }
    result.set(token.slice(2), value);
    index += 1;
  }
  return result;
}

function required(values: Map<string, string>, name: string): string {
  const value = values.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

function numberOption(
  values: Map<string, string>,
  name: string,
  fallback: number,
): number {
  const raw = values.get(name);
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return value;
}

async function ensureMigrations(
  pool: ReturnType<typeof createDatabasePool>,
): Promise<void> {
  const target = process.env.MIGRATION_TARGET?.trim();
  await migrate(pool, target ? { target } : {});
}

class UnknownOutcomeGateway implements CancellationProviderGateway {
  async cancel(
    _input: Parameters<CancellationProviderGateway["cancel"]>[0],
  ): Promise<never> {
    throw new Error("simulated transport timeout after unknown provider outcome");
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const values = options(process.argv.slice(3));
  if (!command) {
    throw new Error("Provide an operational command");
  }

  const pool = createDatabasePool();
  try {
    await waitForDatabase(pool);

    if (command === "prepare-pending") {
      await ensureMigrations(pool);
      const orderId = values.get("order") ?? "order-1001";
      const customerId = values.get("customer") ?? "customer-1";
      const idempotencyKey = values.get("key") ?? `ops-${orderId}-0001`;
      await seedOrder(pool, { id: orderId, customerId });
      const service = new PostgresOrderCancellationService(pool);
      const context = await service.getContext(customerId, orderId);
      const receipt = await service.requestCancellation({
        actorId: customerId,
        orderId,
        idempotencyKey,
        body: {
          reasonCode: "ORDERED_BY_MISTAKE",
          expectedVersion: context.orderVersion,
        },
        traceId: values.get("trace") ?? `trace-${orderId}`,
      });
      console.log(JSON.stringify({ command, receipt }));
      return;
    }

    if (command === "snapshot") {
      const counts = await pool.query(`
        SELECT
          (SELECT count(*)::integer FROM orders) AS orders,
          (SELECT count(*)::integer FROM order_cancellations) AS cancellations,
          (SELECT count(*)::integer FROM outbox_events) AS outbox_events,
          (SELECT count(*)::integer FROM audit_events) AS audit_events,
          (SELECT count(*)::integer FROM order_cancellations WHERE status = 'PENDING') AS pending,
          (SELECT count(*)::integer FROM order_cancellations WHERE status = 'COMPLETED') AS completed,
          (SELECT count(*)::integer FROM order_cancellations WHERE status = 'FAILED') AS failed
      `);
      const migrations = await pool.query(
        "SELECT version FROM schema_migrations ORDER BY version",
      );
      const reconciliationTable = await pool.query(
        "SELECT to_regclass('public.reconciliation_cases')::text AS table_name",
      );
      let reconciliationCases: number | null = null;
      if (reconciliationTable.rows[0]?.table_name) {
        const result = await pool.query(
          "SELECT count(*)::integer AS count FROM reconciliation_cases",
        );
        reconciliationCases = Number(result.rows[0]?.count ?? 0);
      }
      console.log(JSON.stringify({
        command,
        counts: counts.rows[0],
        migrations: migrations.rows.map((row) => String(row.version)),
        reconciliationCases,
      }));
      return;
    }

    await ensureMigrations(pool);

    if (command === "run-worker") {
      const worker = new PostgresOutboxWorker({
        pool,
        gateway: new PostgresIdempotentProviderGateway(pool),
        workerId: values.get("worker") ?? "ops-recovery-worker",
      });
      console.log(JSON.stringify({ command, result: await worker.runOnce() }));
      return;
    }

    if (command === "create-reconciliation") {
      const orderId = values.get("order") ?? "order-2001";
      const customerId = values.get("customer") ?? "customer-1";
      const idempotencyKey = values.get("key") ?? `ops-${orderId}-0001`;
      await seedOrder(pool, { id: orderId, customerId, amountMinor: 77000 });
      const service = new PostgresOrderCancellationService(pool);
      const context = await service.getContext(customerId, orderId);
      const receipt = await service.requestCancellation({
        actorId: customerId,
        orderId,
        idempotencyKey,
        body: {
          reasonCode: "DELIVERY_TOO_LATE",
          expectedVersion: context.orderVersion,
        },
        traceId: values.get("trace") ?? `trace-${orderId}`,
      });
      const worker = new PostgresOutboxWorker({
        pool,
        gateway: new UnknownOutcomeGateway(),
        workerId: values.get("worker") ?? "ops-unknown-outcome-worker",
        maxAttempts: 1,
      });
      const workerResult = await worker.runOnce();
      const reconciliation = new PostgresReconciliationService(pool);
      const caseItem = (await reconciliation.listOpen(200)).find(
        (item) => item.cancellationId === receipt.cancellationId,
      );
      if (!caseItem) {
        throw new Error("Unknown-outcome processing did not open a reconciliation case");
      }
      console.log(JSON.stringify({
        command,
        receipt,
        workerResult,
        reconciliationCase: caseItem,
      }));
      return;
    }

    const reconciliation = new PostgresReconciliationService(pool);

    if (command === "list-reconciliation") {
      console.log(JSON.stringify({
        command,
        cases: await reconciliation.listOpen(
          numberOption(values, "limit", 50),
        ),
      }));
      return;
    }

    if (command === "resolve-reconciliation") {
      const rawResolution = required(values, "resolution").toUpperCase();
      if (rawResolution !== "COMPLETED" && rawResolution !== "FAILED") {
        throw new Error("--resolution must be completed or failed");
      }
      const resolveInput: Parameters<
        PostgresReconciliationService["resolve"]
      >[0] = {
        caseId: numberOption(values, "case", 0),
        actorId: values.get("actor") ?? "operator-1",
        resolution: rawResolution as ReconciliationResolution,
      };
      const providerReference = values.get("provider-reference");
      if (providerReference) {
        resolveInput.providerReference = providerReference;
      }
      const note = values.get("note");
      if (note) {
        resolveInput.note = note;
      }
      const result = await reconciliation.resolve(resolveInput);
      console.log(JSON.stringify({ command, reconciliationCase: result }));
      return;
    }

    if (command === "health") {
      console.log(JSON.stringify({
        command,
        health: await reconciliation.getHealth(),
      }));
      return;
    }

    throw new Error(`Unknown operational command: ${command}`);
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
