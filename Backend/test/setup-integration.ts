/**
 * Corre antes de importar la app. Apunta el pool al Postgres de test y
 * anula DB_* del .env local para no tocar la base del ecommerce.
 */
const testUrl = process.env.TEST_DATABASE_URL?.trim();

process.env.NODE_ENV = "test";
process.env.ARCA_PRODUCTION = "false";
process.env.DB_HOST = "";
process.env.DB_USER = "";
process.env.DB_NAME = "";
process.env.DB_PASSWORD = "";

if (testUrl) {
  process.env.DATABASE_URL = testUrl;
} else if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";
}
