import { getConfig } from "@repovista/config";
import { migrateDatabase } from "./migrate.js";
import { createDatabasePool } from "./pool.js";

async function main(): Promise<void> {
  const command = process.argv[2];
  const config = getConfig();
  const pool = createDatabasePool(config.DATABASE_URL, config.DATABASE_MAX_CONNECTIONS);

  try {
    if (command === "migrate") {
      const migrations = await migrateDatabase(pool);
      console.log(
        migrations.length === 0
          ? "Database is up to date."
          : `Applied migrations: ${migrations.join(", ")}`,
      );
      return;
    }

    if (command === "seed") {
      await migrateDatabase(pool);
      console.log("The public demo workspace is seeded by the initial migration.");
      return;
    }

    throw new Error("Usage: database <migrate|seed>");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
