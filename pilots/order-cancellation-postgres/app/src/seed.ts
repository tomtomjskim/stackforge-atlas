import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabasePool } from "./db.ts";
import { createDatabasePool, waitForDatabase } from "./db.ts";
import { migrate } from "./migrate.ts";

export async function seedOrder(
  pool: DatabasePool,
  input: {
    id?: string;
    customerId?: string;
    version?: number;
    paymentStatus?: "PAID" | "REFUND_PENDING" | "REFUNDED";
    shipmentStatus?: "NOT_STARTED" | "PROCESSING" | "SHIPPED";
    currency?: string;
    amountMinor?: number;
  } = {},
): Promise<void> {
  await pool.query(
    `
      INSERT INTO orders(
        id,
        customer_id,
        version,
        payment_status,
        shipment_status,
        currency,
        amount_minor
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO NOTHING
    `,
    [
      input.id ?? "order-1001",
      input.customerId ?? "customer-1",
      input.version ?? 1,
      input.paymentStatus ?? "PAID",
      input.shipmentStatus ?? "NOT_STARTED",
      input.currency ?? "KRW",
      input.amountMinor ?? 129000,
    ],
  );
}

async function main(): Promise<void> {
  const pool = createDatabasePool();
  try {
    await waitForDatabase(pool);
    await migrate(pool);
    await seedOrder(pool);
    console.log(JSON.stringify({
      event: "database.seeded",
      pilotActor: "customer-1",
      pilotOrder: "order-1001",
    }));
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
