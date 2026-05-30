import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, type DbClient } from "../config/db.js";
import { CONFIGURED_DB_NAME, env } from "../config/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Confirmado al arrancar; evita falsos "missing" bajo carga en /health. */
let posSchemaReady = false;

function schemaPath() {
  return join(__dirname, "schema.pos.sql");
}

export function markPosSchemaReady(): void {
  posSchemaReady = true;
}

export function isPosSchemaReady(): boolean {
  return posSchemaReady;
}

/** Divide el SQL en sentencias (node-pg no ejecuta bien scripts multi-statement en todos los entornos). */
export function splitSqlStatements(sql: string): string[] {
  const withoutBlock = sql.replace(/\/\*[\s\S]*?\*\//g, "");
  const lines = withoutBlock.split("\n").map((line) => line.replace(/--.*$/, ""));
  return lines
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function assertEcommerceSchema(): Promise<void> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'product_variants'
     ) AS exists`,
  );
  if (!rows[0]?.exists) {
    throw new Error(
      "Falta el schema del ecommerce (product_variants). Ejecutá las migraciones en Radio Colonia/app (incl. 0005_pos_operational_tables.sql).",
    );
  }
}

export async function posTablesExist(): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'pos_ventas'
     ) AS exists`,
  );
  return rows[0]?.exists === true;
}

export async function logDbTarget(): Promise<void> {
  const { rows } = await pool.query<{
    db: string;
    has_pos: boolean;
    server: string | null;
  }>(
    `SELECT current_database() AS db,
            host(inet_server_addr()) AS server,
            EXISTS (
              SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'pos_ventas'
            ) AS has_pos`,
  );
  const redacted = env.DATABASE_URL.replace(/:[^:@]+@/, ":****@");
  const db = rows[0]?.db ?? "?";
  console.log(
    `[POS] DB=${db} server=${rows[0]?.server ?? "?"} pos_ventas=${rows[0]?.has_pos ? "sí" : "no"} url=${redacted}`,
  );
  if (CONFIGURED_DB_NAME && db !== CONFIGURED_DB_NAME) {
    console.error(
      `[POS] Base incorrecta: conectado a "${db}", DB_NAME=${CONFIGURED_DB_NAME}. ` +
        "Copiá DB_* exactamente del stack del ecommerce.",
    );
  }
}

let schemaApplyLock: Promise<void> | null = null;
let schemaReadyPromise: Promise<void> | null = null;

export async function validateConnectedDatabase(): Promise<void> {
  if (!CONFIGURED_DB_NAME) return;
  const { rows } = await pool.query<{ db: string }>(
    "SELECT current_database() AS db",
  );
  const db = rows[0]?.db;
  if (db && db !== CONFIGURED_DB_NAME) {
    throw new Error(
      `DB_NAME=${CONFIGURED_DB_NAME} pero current_database()="${db}". ` +
        "Revisá DB_HOST y eliminá DATABASE_URL si apunta a otra base.",
    );
  }
}

async function applyPosSchemaInternal(): Promise<void> {
  if (schemaApplyLock) {
    await schemaApplyLock;
    return;
  }
  schemaApplyLock = (async () => {
    await assertEcommerceSchema();
    const sql = readFileSync(schemaPath(), "utf-8");
    const statements = splitSqlStatements(sql);
    console.log(`Aplicando schema.pos.sql (${statements.length} sentencias)...`);
    for (const statement of statements) {
      await pool.query(statement);
    }
    console.log("Schema POS aplicado.");
  })();
  try {
    await schemaApplyLock;
  } finally {
    schemaApplyLock = null;
  }
}

export async function applyPosSchema(): Promise<void> {
  await applyPosSchemaInternal();
  if (await posTablesExist()) {
    markPosSchemaReady();
  }
}

/**
 * Aplica el schema POS sobre una conexión específica del pool.
 * Necesario porque el pool puede abrir varias conexiones y, según la infra
 * (HA / réplicas / hostname con varias IPs), una conexión puede no tener
 * todavía las tablas pos_*. Se crea sobre la MISMA conexión que reintentará.
 */
export async function applyPosSchemaOnClient(client: DbClient): Promise<void> {
  const sql = readFileSync(schemaPath(), "utf-8");
  const statements = splitSqlStatements(sql);
  for (const statement of statements) {
    await client.query(statement);
  }
}

async function ensurePosSchemaInternal(): Promise<void> {
  if (posSchemaReady || (await posTablesExist())) {
    markPosSchemaReady();
    return;
  }
  console.warn("Tablas pos_* no encontradas; aplicando schema POS...");
  await applyPosSchemaInternal();
  if (!(await posTablesExist())) {
    throw new Error("No se pudo crear pos_ventas tras aplicar schema.pos.sql");
  }
  markPosSchemaReady();
}

/** Idempotente y single-flight: crea tablas pos_* una sola vez por proceso. */
export async function ensurePosSchema(): Promise<void> {
  if (posSchemaReady) return;
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensurePosSchemaInternal();
  }
  try {
    await schemaReadyPromise;
  } catch (err) {
    schemaReadyPromise = null;
    throw err;
  }
}

export function isMissingPosTableError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "42P01"
  );
}
