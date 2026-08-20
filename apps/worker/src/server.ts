import { getConfig } from "@repovista/config";
import { createDatabasePool, migrateDatabase, RepoVistaStore } from "@repovista/database";
import { executeNextIndexJob } from "./indexer.js";
import { executeNextPullRequestAnalysisJob } from "./pull-request-analyzer.js";

let stopping = false;

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main(): Promise<void> {
  const config = getConfig();
  const pool = createDatabasePool(config.DATABASE_URL, config.DATABASE_MAX_CONNECTIONS);
  if (config.RUN_MIGRATIONS_ON_START) {
    await migrateDatabase(pool);
  }
  const store = new RepoVistaStore(pool);
  await store.ping();
  console.log(`RepoVista worker is ready as ${config.WORKER_ID}.`);

  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });

  while (!stopping) {
    try {
      const processed = await executeNextIndexJob(store, config);
      const analyzed = processed ? false : await executeNextPullRequestAnalysisJob(store, config);
      if (!processed && !analyzed) {
        await wait(config.JOB_POLL_INTERVAL_MS);
      }
    } catch (error) {
      console.error("RepoVista worker loop failed.", error);
      await wait(config.JOB_POLL_INTERVAL_MS);
    }
  }
  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
