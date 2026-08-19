import { getConfig } from "@repovista/config";
import { migrateDatabase } from "@repovista/database";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const config = getConfig();
  const { app, pool } = buildApp({ config });
  if (config.RUN_MIGRATIONS_ON_START) {
    await migrateDatabase(pool);
  }
  await app.listen({ host: "0.0.0.0", port: config.API_PORT });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
