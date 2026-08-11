import { Pool, type PoolClient, type PoolConfig } from "pg";

export type DatabasePool = Pool;

export function createDatabasePool(
  connectionString = process.env.DATABASE_URL ??
    "postgresql://stackforge:stackforge@127.0.0.1:5432/stackforge",
): DatabasePool {
  const config: PoolConfig = {
    connectionString,
    application_name: "stackforge-order-cancellation-postgres-pilot",
    max: Number.parseInt(process.env.PGPOOL_MAX ?? "10", 10),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
  };
  const pool = new Pool(config);
  pool.on("error", (error) => {
    console.error(JSON.stringify({
      event: "postgres.pool.error",
      message: error.message,
    }));
  });
  return pool;
}

export async function withTransaction<T>(
  pool: DatabasePool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original application or database error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function waitForDatabase(
  pool: DatabasePool,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  const attempts = options.attempts ?? 30;
  const delayMs = options.delayMs ?? 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("PostgreSQL is unavailable");
}

export function isPostgresError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && "code" in error && typeof error.code === "string";
}
