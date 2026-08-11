import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabasePool, waitForDatabase } from "./db.ts";
import { createRequestHandler } from "./http.ts";
import { migrate } from "./migrate.ts";
import { seedOrder } from "./seed.ts";
import { PostgresOrderCancellationService } from "./service.ts";

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

export async function startServer(): Promise<void> {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const pool = createDatabasePool();
  await waitForDatabase(pool);
  if (process.env.AUTO_MIGRATE === "1") {
    await migrate(pool);
  }
  if (process.env.AUTO_SEED === "1") {
    await seedOrder(pool);
  }

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

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolveListen());
  });

  console.log(JSON.stringify({
    event: "server.started",
    port,
    pilotActor: "customer-1",
    pilotOrder: "order-1001",
    persistence: "postgresql",
  }));

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(JSON.stringify({ event: "server.stopping", signal }));

    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    });
    await pool.end();
    console.log(JSON.stringify({ event: "server.stopped" }));
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await startServer();
}
