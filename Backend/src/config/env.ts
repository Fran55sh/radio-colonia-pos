import "dotenv/config";
import { z } from "zod";

function buildDatabaseUrlFromParts(): string | undefined {
  const host = process.env.DB_HOST?.trim();
  const user = process.env.DB_USER?.trim();
  const dbName = process.env.DB_NAME?.trim();
  if (!host || !user || !dbName) return undefined;
  if (process.env.DB_PASSWORD === undefined) return undefined;
  const password = process.env.DB_PASSWORD ?? "";
  const port = (process.env.DB_PORT ?? "5432").trim() || "5432";
  const u = encodeURIComponent(user);
  const p = encodeURIComponent(password);
  return `postgresql://${u}:${p}@${host}:${port}/${dbName}`;
}

/** DB_NAME declarado en el stack (debe coincidir con el ecommerce). */
export const CONFIGURED_DB_NAME = process.env.DB_NAME?.trim() || undefined;

function databaseNameFromUrl(url: string): string | undefined {
  try {
    const name = new URL(url).pathname.replace(/^\//, "").trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}

function resolveDatabaseUrl(): string {
  const built = buildDatabaseUrlFromParts();
  const direct = process.env.DATABASE_URL?.trim();

  // Coolify: priorizar DB_* iguales al stack del ecommerce.
  if (built) {
    if (direct) {
      const urlDb = databaseNameFromUrl(direct);
      const partsDb = process.env.DB_NAME?.trim();
      if (direct !== built) {
        console.warn(
          `[POS] DATABASE_URL y DB_* difieren. Usando DB_HOST/DB_NAME del stack ` +
            `(${partsDb ?? urlDb ?? "?"}). Eliminá DATABASE_URL del POS si no es la misma conexión que el ecommerce.`,
        );
      }
    }
    return built;
  }

  if (direct) return direct;

  throw new Error(
    "Configurá DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (mismos valores que el ecommerce) o DATABASE_URL.",
  );
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default("0.0.0.0"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  API_TOKEN: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  POS_SEED_DEMO: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  POS_ACCESS_PIN: z.string().min(4).optional(),
  /** PIN con rol admin (analytics + contabilidad + clientes + fiscal). */
  POS_ADMIN_PIN: z.string().min(4).optional(),
  /** Rol del PIN de caja si no coincide admin. Default caja. */
  POS_DEFAULT_ROLE: z
    .enum(["caja", "compras", "admin"])
    .default("caja")
    .transform((v) => (v === "compras" ? "caja" : v)),
  POS_JWT_SECRET: z.string().min(16).optional(),
  POS_SESSION_HOURS: z.coerce.number().int().positive().default(12),
  /** Si true, ventas POS exigen sesión de caja abierta (o caja_sesion_id válido). */
  POS_CAJA_REQUIRE_SESSION: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /**
   * Si true, ventas/facturas escriben inventory_movements (requiere migración ecommerce 0022).
   * Default off: deploy POS sin cambiar comportamiento hasta activar el flag.
   */
  POS_STOCK_LEDGER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Timeout SOAP de cada intento ARCA. Default 10 s (D3). */
  ARCA_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  /** Reintentos del SDK ante timeout, red o HTTP 5xx. Default 1 (D3). */
  ARCA_RETRIES: z.coerce.number().int().min(0).default(1),
  /** Espera máxima para conseguir una conexión del pool. Default 5 s (D3). */
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  /** Presupuesto de la emisión dentro de POST /pos/ventas. Default 25 s (D3). */
  FISCAL_EMISION_BUDGET_MS: z.coerce.number().int().positive().default(25_000),
  /** lock_timeout de los advisory locks fiscales. Default 20 s (D3). */
  FISCAL_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  /** Barrido de comprobantes enviando/desconocido. Default 5 min (D4). */
  FISCAL_CONCILIACION_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
});

const databaseUrl = resolveDatabaseUrl();

export const env = envSchema.parse({
  DATABASE_URL: databaseUrl,
  PORT: process.env.PORT,
  HOST: process.env.HOST,
  CORS_ORIGIN: process.env.CORS_ORIGIN,
  API_TOKEN: process.env.API_TOKEN || undefined,
  NODE_ENV: process.env.NODE_ENV,
  POS_SEED_DEMO: process.env.POS_SEED_DEMO,
  POS_ACCESS_PIN: process.env.POS_ACCESS_PIN || undefined,
  POS_ADMIN_PIN: process.env.POS_ADMIN_PIN || undefined,
  POS_DEFAULT_ROLE: process.env.POS_DEFAULT_ROLE,
  POS_JWT_SECRET: process.env.POS_JWT_SECRET || undefined,
  POS_SESSION_HOURS: process.env.POS_SESSION_HOURS,
  POS_CAJA_REQUIRE_SESSION: process.env.POS_CAJA_REQUIRE_SESSION,
  POS_STOCK_LEDGER_ENABLED: process.env.POS_STOCK_LEDGER_ENABLED,
  ARCA_REQUEST_TIMEOUT_MS: process.env.ARCA_REQUEST_TIMEOUT_MS,
  ARCA_RETRIES: process.env.ARCA_RETRIES,
  DB_CONNECTION_TIMEOUT_MS: process.env.DB_CONNECTION_TIMEOUT_MS,
  FISCAL_EMISION_BUDGET_MS: process.env.FISCAL_EMISION_BUDGET_MS,
  FISCAL_LOCK_TIMEOUT_MS: process.env.FISCAL_LOCK_TIMEOUT_MS,
  FISCAL_CONCILIACION_INTERVAL_MS: process.env.FISCAL_CONCILIACION_INTERVAL_MS,
});

if (env.NODE_ENV === "production") {
  if (!env.POS_ACCESS_PIN) {
    throw new Error(
      "POS_ACCESS_PIN es obligatorio en producción. Configurá la clave compartida del local.",
    );
  }
  if (!env.POS_JWT_SECRET) {
    throw new Error(
      "POS_JWT_SECRET es obligatorio en producción (mín. 16 caracteres).",
    );
  }
}
