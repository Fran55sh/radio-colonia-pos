import { pool } from "../config/db.js";
import { CONFIGURED_DB_NAME, env } from "../config/env.js";

/** Catálogo ecommerce + tablas operativas POS (creadas por migrador del ecommerce). */
export const REQUIRED_TABLES = [
  "products",
  "product_variants",
  "product_variant_price_tiers",
  "product_price_tiers",
  "product_supplier_offers",
  "suppliers",
  "pos_clientes",
  "pos_ventas",
  "pos_lineas_venta",
  "pos_iva_registro",
  "pos_ordenes_compra",
  "pos_ordenes_compra_lineas",
  "pos_facturas_compra",
  "pos_comprobantes_fiscales",
] as const;

/** Confirmado al arrancar; /health no reconsulta information_schema bajo carga. */
let schemaReady = false;

export function markSchemaReady(): void {
  schemaReady = true;
}

export function isSchemaReady(): boolean {
  return schemaReady;
}

export async function tableExists(table: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [table],
  );
  return rows[0]?.exists === true;
}

export async function assertRequiredSchema(): Promise<void> {
  const missing: string[] = [];
  for (const table of REQUIRED_TABLES) {
    if (!(await tableExists(table))) {
      missing.push(table);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Faltan tablas requeridas: ${missing.join(", ")}. ` +
        "Ejecutá el migrador del ecommerce (Radio Colonia/app migrate.sh) antes de desplegar el POS.",
    );
  }
  markSchemaReady();
}

export async function logDbTarget(): Promise<void> {
  const { rows } = await pool.query<{ db: string }>(
    "SELECT current_database() AS db",
  );
  const redacted = env.DATABASE_URL.replace(/:[^:@]+@/, ":****@");
  const db = rows[0]?.db ?? "?";
  const hasPos = await tableExists("pos_ventas");
  console.log(
    `[POS] DB=${db} pos_ventas=${hasPos ? "sí" : "no"} url=${redacted}`,
  );
  if (CONFIGURED_DB_NAME && db !== CONFIGURED_DB_NAME) {
    console.error(
      `[POS] Base incorrecta: conectado a "${db}", DB_NAME=${CONFIGURED_DB_NAME}. ` +
        "Copiá DB_* exactamente del stack del ecommerce.",
    );
  }
}

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
