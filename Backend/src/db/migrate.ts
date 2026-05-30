import { pool } from "../config/db.js";
import {
  assertRequiredSchema,
  logDbTarget,
  validateConnectedDatabase,
} from "./verify-schema.js";

async function verify() {
  await logDbTarget();
  await validateConnectedDatabase();
  await assertRequiredSchema();
  await logDbTarget();
  console.log("Verificación de schema POS completada.");
  await pool.end();
}

verify().catch((err) => {
  console.error("Error en verificación de schema:", err);
  process.exit(1);
});
