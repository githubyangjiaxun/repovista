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
  let connectionError: Error | undefined;
  const handleConnectionError = (error: Error) => {
    connectionError = error;
  };
  client.on("error", handleConnectionError);
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (!connectionError) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        if (rollbackError instanceof Error) {
          connectionError = rollbackError;
        }
      }
    }
    throw error;
  } finally {
    client.release(connectionError);
    client.off("error", handleConnectionError);
  }
}
