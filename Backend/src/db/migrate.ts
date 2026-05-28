import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../config/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function assertEcommerceSchema() {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'product_variants'
     ) AS exists`,
  );
  if (!rows[0]?.exists) {
    throw new Error(
      "Falta el schema del ecommerce (product_variants). Ejecutá primero las migraciones en Radio Colonia/app.",
    );
  }
}

async function migrate() {
  await assertEcommerceSchema();
  const schemaPath = join(__dirname, "schema.pos.sql");
  const sql = readFileSync(schemaPath, "utf-8");
  console.log("Aplicando schema.pos.sql (tablas operativas POS)...");
  await pool.query(sql);
  console.log("Migración POS completada.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Error en migración:", err);
  process.exit(1);
});
