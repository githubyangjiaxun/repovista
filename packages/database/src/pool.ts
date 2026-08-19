import { Pool, type PoolClient, type PoolConfig } from "pg";

export type DatabasePool = Pool;
export type DatabaseClient = PoolClient;

export function createDatabasePool(connectionString: string, maxConnections = 10): DatabasePool {
  const config: PoolConfig = {
    connectionString,
    max: maxConnections,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: "repovista",
  };

  const pool = new Pool(config);
  pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error", error);
  });
  return pool;
}

export async function withTransaction<T>(
  pool: DatabasePool,
  callback: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
