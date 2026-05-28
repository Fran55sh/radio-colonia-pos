/**
 * Verificación rápida de base unificada (solo lectura).
 * Uso: npx tsx scripts/verify-unified-db.ts
 */
import "dotenv/config";
import pg from "pg";
import { env } from "../src/config/env.js";

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

async function main() {
  const checks = [
    { name: "product_variants (ecommerce)", sql: "SELECT COUNT(*)::int AS n FROM product_variants" },
    { name: "pos_ventas", sql: "SELECT COUNT(*)::int AS n FROM pos_ventas" },
    { name: "pos_lineas_venta", sql: "SELECT COUNT(*)::int AS n FROM pos_lineas_venta" },
  ];

  console.log("DB:", env.DATABASE_URL.replace(/:[^:@]+@/, ":****@"));

  for (const c of checks) {
    try {
      const { rows } = await pool.query<{ n: number }>(c.sql);
      console.log(`OK  ${c.name}: ${rows[0]?.n ?? 0} filas`);
    } catch (err) {
      console.error(`FAIL ${c.name}:`, err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  }

  const catalog = await pool.query<{ sku: string; stock: number }>(
    `SELECT LOWER(pv.sku) AS sku, pv.stock
     FROM product_variants pv
     INNER JOIN products p ON p.id = pv.product_id
     WHERE p.is_active = TRUE
     LIMIT 3`,
  );
  console.log("Muestra catálogo POS:", catalog.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
