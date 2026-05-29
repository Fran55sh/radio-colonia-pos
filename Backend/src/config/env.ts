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

function resolveDatabaseUrl(): string {
  const built = buildDatabaseUrlFromParts();
  const direct = process.env.DATABASE_URL?.trim();

  // Coolify a veces inyecta DATABASE_URL de otro Postgres; DB_* debe ganar.
  if (built) {
    if (direct && direct !== built) {
      console.warn(
        `[POS] DATABASE_URL y DB_* no coinciden. Usando DB_NAME=${process.env.DB_NAME}. ` +
          "Eliminá DATABASE_URL del stack POS en Coolify si apunta a otra base.",
      );
    }
    return built;
  }

  if (direct) return direct;

  throw new Error(
    "Configurá DATABASE_URL o DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (y opcionalmente DB_PORT).",
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
});
