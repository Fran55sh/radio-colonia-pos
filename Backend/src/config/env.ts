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
  POS_JWT_SECRET: z.string().min(16).optional(),
  POS_SESSION_HOURS: z.coerce.number().int().positive().default(12),
  COMPRAS_PDF_DIR: z.string().default("./data/compras-pdfs"),
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
  POS_JWT_SECRET: process.env.POS_JWT_SECRET || undefined,
  POS_SESSION_HOURS: process.env.POS_SESSION_HOURS,
  COMPRAS_PDF_DIR: process.env.COMPRAS_PDF_DIR,
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
