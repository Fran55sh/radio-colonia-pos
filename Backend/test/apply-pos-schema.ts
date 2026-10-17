import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/config/db.js";

const schemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/pos-schema.sql",
);

export async function applyPosSchema(): Promise<void> {
  const sql = readFileSync(schemaPath, "utf8");
  await pool.query(sql);
}

export async function closePool(): Promise<void> {
  await pool.end();
}
