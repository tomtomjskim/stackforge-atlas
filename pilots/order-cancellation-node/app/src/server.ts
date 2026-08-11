import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequestHandler } from "./http.ts";
import {
  DelayedSuccessGateway,
  OrderCancellationService,
} from "./service.ts";
import { InMemoryCancellationStore } from "./store.ts";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const publicDirectory = join(currentDirectory, "..", "public");
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const store = new InMemoryCancellationStore(() => `cancel_${randomUUID()}`);
store.seedOrder({
  id: "order-1001",
  customerId: "customer-1",
  version: 1,
  paymentStatus: "PAID",
  shipmentStatus: "NOT_STARTED",
  paidAmount: { currency: "KRW", amountMinor: 129000 },
});

const service = new OrderCancellationService({
  store,
  gateway: new DelayedSuccessGateway(900),
});

const server = createServer(
  createRequestHandler({
    service,
    publicDirectory,
  }),
);

server.listen(port, "127.0.0.1", () => {
  console.log(
    JSON.stringify({
      event: "server.started",
      port,
      pilotActor: "customer-1",
      pilotOrder: "order-1001",
    }),
  );
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(JSON.stringify({ event: "server.stopping", signal }));
  await Promise.all([
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
    service.drain(),
  ]);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
