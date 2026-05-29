import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../config/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function schemaPath() {
  return join(__dirname, "schema.pos.sql");
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

export async function applyPosSchema(): Promise<void> {
  await assertEcommerceSchema();
  const sql = readFileSync(schemaPath(), "utf-8");
  console.log("Aplicando schema.pos.sql (tablas operativas POS)...");
  await pool.query(sql);
  console.log("Schema POS aplicado.");
}

/** Idempotente: crea tablas pos_* si aún no existen. */
export async function ensurePosSchema(): Promise<void> {
  if (await posTablesExist()) {
    return;
  }
  console.warn("Tablas pos_* no encontradas; aplicando schema POS...");
  await applyPosSchema();
  if (!(await posTablesExist())) {
    throw new Error("No se pudo crear pos_ventas tras aplicar schema.pos.sql");
  }
}
