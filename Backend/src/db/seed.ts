import { pool } from "../config/db.js";

/**
 * El catálogo vive en el ecommerce (products / product_variants).
 * Este seed no inserta productos dummy.
 */
async function seed() {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const seedDemo = process.env.POS_SEED_DEMO === "true";

  if (nodeEnv === "production" && !seedDemo) {
    console.log("Seed omitido en producción (catálogo = ecommerce).");
    await pool.end();
    return;
  }

  console.log(
    "Seed POS: sin catálogo dummy. Usá el admin del ecommerce o POS_SEED_DEMO=true solo en entornos de prueba.",
  );
  await pool.end();
}

seed().catch((err) => {
  console.error("Error en seed:", err);
  process.exit(1);
});
