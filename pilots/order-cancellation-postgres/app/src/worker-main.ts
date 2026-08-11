import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabasePool, waitForDatabase } from "./db.ts";
import { migrate } from "./migrate.ts";
import {
  PostgresIdempotentProviderGateway,
  PostgresOutboxWorker,
} from "./worker.ts";

const sleep = (milliseconds: number) =>
  new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds));

export async function runWorkerLoop(): Promise<void> {
  const pool = createDatabasePool();
  let stopping = false;
  const stop = (signal: string) => {
    if (!stopping) {
      stopping = true;
      console.log(JSON.stringify({ event: "worker.stopping", signal }));
    }
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));

  try {
    await waitForDatabase(pool);
    await migrate(pool);
    const workerOptions: ConstructorParameters<
      typeof PostgresOutboxWorker
    >[0] = {
      pool,
      gateway: new PostgresIdempotentProviderGateway(pool),
      leaseSeconds: Number.parseInt(
        process.env.WORKER_LEASE_SECONDS ?? "30",
        10,
      ),
      maxAttempts: Number.parseInt(
        process.env.WORKER_MAX_ATTEMPTS ?? "5",
        10,
      ),
    };
    if (process.env.WORKER_ID) {
      workerOptions.workerId = process.env.WORKER_ID;
    }
    const worker = new PostgresOutboxWorker(workerOptions);

    console.log(JSON.stringify({ event: "worker.started" }));
    while (!stopping) {
      const result = await worker.runOnce();
      if (result === "idle") {
        await sleep(Number.parseInt(process.env.WORKER_IDLE_MS ?? "250", 10));
      } else {
        console.log(JSON.stringify({ event: "worker.event.result", result }));
      }
    }
  } finally {
    await pool.end();
    console.log(JSON.stringify({ event: "worker.stopped" }));
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runWorkerLoop();
}
