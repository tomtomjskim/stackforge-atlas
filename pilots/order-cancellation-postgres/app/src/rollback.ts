import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabasePool } from "./db.ts";
import { createDatabasePool, waitForDatabase, withTransaction } from "./db.ts";
import { migrationDirectory } from "./migrate.ts";

function downFilename(version: string): string {
  if (!/^\d+_.+\.sql$/.test(version) || version.endsWith(".down.sql")) {
    throw new Error(`Invalid migration version: ${version}`);
  }
  return version.replace(/\.sql$/, ".down.sql");
}

export async function rollbackMigration(
  pool: DatabasePool,
  version: string,
): Promise<void> {
  const downPath = resolve(migrationDirectory, downFilename(version));
  await access(downPath);
  const sql = await readFile(downPath, "utf-8");

  await withTransaction(pool, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["stackforge-order-cancellation-migrations"],
    );
    const applied = await client.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1 FOR UPDATE",
      [version],
    );
    if (!applied.rowCount) {
      throw new Error(`Migration is not applied: ${version}`);
    }

    const later = await client.query(
      "SELECT version FROM schema_migrations WHERE version > $1 ORDER BY version",
      [version],
    );
    if (later.rowCount) {
      throw new Error(
        `Cannot roll back ${version} while later migrations remain applied: ${later.rows
          .map((row) => String(row.version))
          .join(", ")}`,
      );
    }

    await client.query(sql);
    await client.query(
      "DELETE FROM schema_migrations WHERE version = $1",
      [version],
    );
  });
}

async function main(): Promise<void> {
  const version = process.argv[2] ?? process.env.MIGRATION_VERSION;
  if (!version) {
    throw new Error("Provide a migration version to roll back");
  }

  const pool = createDatabasePool();
  try {
    await waitForDatabase(pool);
    await rollbackMigration(pool, version);
    console.log(JSON.stringify({
      event: "database.migration.rolled_back",
      version,
    }));
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
