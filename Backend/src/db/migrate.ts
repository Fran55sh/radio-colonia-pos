import { pool } from "../config/db.js";
import { applyPosSchema, logDbTarget } from "./ensure-pos-schema.js";

async function migrate() {
  await logDbTarget();
  await applyPosSchema();
  await logDbTarget();
  console.log("Migración POS completada.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Error en migración:", err);
  process.exit(1);
});
