import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { DatabasePool } from "./pool.js";
import { withTransaction } from "./pool.js";

function migrationDirectory(): string {
  return path.resolve(process.cwd(), "packages/database/migrations");
}

export async function migrateDatabase(pool: DatabasePool): Promise<string[]> {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (" +
      "version text PRIMARY KEY, " +
      "applied_at timestamptz NOT NULL DEFAULT now()" +
      ")",
  );

  const files = (await readdir(migrationDirectory()))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const appliedRows = await pool.query<{ version: string }>(
    "SELECT version FROM schema_migrations",
  );
  const applied = new Set(appliedRows.rows.map((row) => row.version));
  const executed: string[] = [];

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const sql = await readFile(path.join(migrationDirectory(), file), "utf8");
    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING",
        [file],
      );
    });
    executed.push(file);
  }

  return executed;
}
