import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { ApplicationError, PostgresOrderCancellationService } from "./service.ts";
import type { ErrorBody } from "./types.ts";

export interface LogEvent {
  event: "http.request.completed";
  traceId: string;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}

export type Logger = (event: LogEvent) => void;

interface ApplicationOptions {
  service: PostgresOrderCancellationService;
  publicDirectory: string;
  healthcheck: () => Promise<void>;
  logger?: Logger;
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'",
  );
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function applicationErrorBody(error: ApplicationError, traceId: string): ErrorBody {
  const body: ErrorBody = {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    traceId,
  };
  if (error.fieldErrors.length > 0) {
    body.fieldErrors = error.fieldErrors;
  }
  if (error.details) {
    body.details = error.details;
  }
  return body;
}

function actorFromRequest(request: IncomingMessage): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new ApplicationError({
      statusCode: 401,
      code: "AUTHENTICATION_REQUIRED",
      message: "Customer authentication is required.",
    });
  }
  const actorId = header.slice("Bearer ".length).trim();
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(actorId)) {
    throw new ApplicationError({
      statusCode: 401,
      code: "AUTHENTICATION_REQUIRED",
      message: "Customer authentication is invalid.",
    });
  }
  return actorId;
}

async function readJsonBody(request: IncomingMessage, limitBytes = 32_768): Promise<unknown> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > limitBytes) {
      throw new ApplicationError({
        statusCode: 400,
        code: "VALIDATION_FAILED",
        message: "Request body is too large.",
      });
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8") || "null");
  } catch {
    throw new ApplicationError({
      statusCode: 400,
      code: "VALIDATION_FAILED",
      message: "Request body must contain valid JSON.",
    });
  }
}

async function serveStatic(
  requestPath: string,
  publicDirectory: string,
  response: ServerResponse,
): Promise<boolean> {
  const publicFiles: Record<string, string> = {
    "/": "index.html",
    "/app.js": "app.js",
    "/styles.css": "styles.css",
  };
  const filename = publicFiles[requestPath];
  if (!filename) {
    return false;
  }
  const filePath = join(publicDirectory, filename);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    return false;
  }
  response.statusCode = 200;
  response.setHeader(
    "Content-Type",
    contentTypes[extname(filePath)] ?? "application/octet-stream",
  );
  response.setHeader("Cache-Control", "no-cache");
  await new Promise<void>((resolveStream, reject) => {
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    response.on("finish", resolveStream);
    stream.pipe(response);
  });
  return true;
}

export async function getOrderCancellationContext(
  service: PostgresOrderCancellationService,
  actorId: string,
  orderId: string,
) {
  return service.getContext(actorId, orderId);
}

export async function requestOrderCancellation(
  service: PostgresOrderCancellationService,
  input: Parameters<PostgresOrderCancellationService["requestCancellation"]>[0],
) {
  return service.requestCancellation(input);
}

export async function getOrderCancellation(
  service: PostgresOrderCancellationService,
  actorId: string,
  cancellationId: string,
) {
  return service.getCancellation(actorId, cancellationId);
}

export function createRequestHandler(options: ApplicationOptions) {
  const logger = options.logger ??
    ((event: LogEvent) => console.log(JSON.stringify(event)));

  return async function requestHandler(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const startedAt = performance.now();
    const method = request.method ?? "GET";
    const traceId =
      typeof request.headers["x-request-id"] === "string" &&
      /^[A-Za-z0-9._-]{8,128}$/.test(request.headers["x-request-id"])
        ? request.headers["x-request-id"]
        : randomUUID();
    let route = "unmatched";

    setSecurityHeaders(response);
    response.setHeader("X-Request-Id", traceId);

    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (method === "GET" && url.pathname === "/health") {
        route = "health";
        await options.healthcheck();
        sendJson(response, 200, { status: "ok", database: "ready" });
        return;
      }

      if (method === "GET") {
        const contextMatch = url.pathname.match(
          /^\/orders\/([^/]+)\/cancellation-context$/,
        );
        if (contextMatch) {
          route = "getOrderCancellationContext";
          const actorId = actorFromRequest(request);
          sendJson(
            response,
            200,
            await getOrderCancellationContext(
              options.service,
              actorId,
              contextMatch[1]!,
            ),
          );
          return;
        }
      }

      if (method === "POST") {
        const commandMatch = url.pathname.match(
          /^\/orders\/([^/]+)\/cancellations$/,
        );
        if (commandMatch) {
          route = "requestOrderCancellation";
          const actorId = actorFromRequest(request);
          const commandInput: Parameters<
            PostgresOrderCancellationService["requestCancellation"]
          >[0] = {
            actorId,
            orderId: commandMatch[1]!,
            body: await readJsonBody(request),
            traceId,
          };
          if (typeof request.headers["idempotency-key"] === "string") {
            commandInput.idempotencyKey = request.headers["idempotency-key"];
          }
          const receipt = await requestOrderCancellation(
            options.service,
            commandInput,
          );
          response.setHeader(
            "Location",
            `/order-cancellations/${receipt.cancellationId}`,
          );
          sendJson(response, 202, receipt);
          return;
        }
      }

      if (method === "GET") {
        const statusMatch = url.pathname.match(
          /^\/order-cancellations\/([^/]+)$/,
        );
        if (statusMatch) {
          route = "getOrderCancellation";
          const actorId = actorFromRequest(request);
          sendJson(
            response,
            200,
            await getOrderCancellation(
              options.service,
              actorId,
              statusMatch[1]!,
            ),
          );
          return;
        }
      }

      if (
        method === "GET" &&
        (await serveStatic(url.pathname, options.publicDirectory, response))
      ) {
        route = "static";
        return;
      }

      route = "notFound";
      sendJson(response, 404, {
        code: "RESOURCE_NOT_FOUND",
        message: "The requested resource does not exist.",
        retryable: false,
        traceId,
      } satisfies ErrorBody);
    } catch (error) {
      if (error instanceof ApplicationError) {
        sendJson(
          response,
          error.statusCode,
          applicationErrorBody(error, traceId),
        );
      } else {
        sendJson(response, 500, {
          code: "CANCELLATION_UNAVAILABLE",
          message: "The cancellation service is temporarily unavailable.",
          retryable: true,
          traceId,
        } satisfies ErrorBody);
      }
    } finally {
      logger({
        event: "http.request.completed",
        traceId,
        method,
        route,
        statusCode: response.statusCode,
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
      });
    }
  };
}
