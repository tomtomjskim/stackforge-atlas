import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabasePool } from "./db.ts";
import { createDatabasePool, waitForDatabase, withTransaction } from "./db.ts";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
export const migrationDirectory = resolve(
  currentDirectory,
  "..",
  "..",
  "migrations",
);

export interface MigrationOptions {
  target?: string;
}

async function listMigrationFiles(): Promise<string[]> {
  return (await readdir(migrationDirectory))
    .filter((name) => /^\d+_.+\.sql$/.test(name) && !name.endsWith(".down.sql"))
    .sort();
}

export async function migrate(
  pool: DatabasePool,
  options: MigrationOptions = {},
): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);

  const migrationFiles = await listMigrationFiles();
  let selectedFiles = migrationFiles;
  if (options.target) {
    const targetIndex = migrationFiles.indexOf(options.target);
    if (targetIndex < 0) {
      throw new Error(`Unknown migration target: ${options.target}`);
    }
    selectedFiles = migrationFiles.slice(0, targetIndex + 1);
  }

  for (const filename of selectedFiles) {
    const alreadyApplied = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1",
      [filename],
    );
    if (alreadyApplied.rowCount) {
      continue;
    }

    const sql = await readFile(resolve(migrationDirectory, filename), "utf-8");
    await withTransaction(pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        ["stackforge-order-cancellation-migrations"],
      );
      const afterLock = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [filename],
      );
      if (afterLock.rowCount) {
        return;
      }
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations(version) VALUES ($1)",
        [filename],
      );
    });
  }
}

async function main(): Promise<void> {
  const pool = createDatabasePool();
  try {
    await waitForDatabase(pool);
    const target = process.env.MIGRATION_TARGET?.trim() || undefined;
    await migrate(pool, target ? { target } : {});
    console.log(JSON.stringify({
      event: "database.migrated",
      target: target ?? "latest",
    }));
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
