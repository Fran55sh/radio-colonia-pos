import pg from "pg";
import { env } from "./env.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
});

export type DbClient = pg.PoolClient;

export type TransactionOptions = {
  /**
   * Llamado si la transacción falla. Si devuelve true, la transacción se
   * reintenta UNA vez sobre la MISMA conexión (útil para crear tablas pos_*
   * que falten en esa conexión concreta del pool).
   */
  recover?: (client: DbClient, error: unknown) => Promise<boolean>;
};

async function runInTransaction<T>(
  client: DbClient,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function withTransaction<T>(
  fn: (client: DbClient) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  const client = await pool.connect();
  try {
    try {
      return await runInTransaction(client, fn);
    } catch (error) {
      if (options?.recover && (await options.recover(client, error))) {
        return await runInTransaction(client, fn);
      }
      throw error;
    }
  } finally {
    client.release();
  }
}

export async function checkDbConnection(): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await pool.query("SELECT 1");
      return true;
    } catch {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 40));
      }
    }
  }
  return false;
}
