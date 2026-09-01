import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { checkDbConnection, pool } from "./config/db.js";
import {
  assertRequiredSchema,
  isSchemaReady,
  logDbTarget,
  validateConnectedDatabase,
} from "./db/verify-schema.js";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errors.js";
import { requireAuth } from "./middleware/auth.js";
import { analyticsRoutes } from "./modules/analytics/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { isAuthConfigured } from "./modules/auth/service.js";
import { clientesRoutes } from "./modules/clientes/routes.js";
import { comprasRoutes } from "./modules/compras/routes.js";
import { contabilidadRoutes } from "./modules/contabilidad/routes.js";
import { fiscalRoutes } from "./modules/fiscal/routes.js";
import { posRoutes } from "./modules/pos/routes.js";
import { ensurePdfStorageDir } from "./modules/compras/importacion/pdf-storage.js";

const healthCache = {
  checkedAt: 0,
  dbOk: true,
};

const HEALTH_CACHE_MS = 10_000;

async function refreshHealthCache(): Promise<void> {
  const now = Date.now();
  if (now - healthCache.checkedAt < HEALTH_CACHE_MS) return;
  healthCache.dbOk = await checkDbConnection();
  healthCache.checkedAt = now;
}

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()),
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });

  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });

  await ensurePdfStorageDir();

  app.addHook("preHandler", requireAuth);
  app.setErrorHandler(errorHandler);

  app.get("/health", async () => {
    await refreshHealthCache();
    const { dbOk } = healthCache;
    const schemaReady = isSchemaReady();
    let database_name: string | undefined;
    if (dbOk) {
      const { rows } = await pool.query<{ db: string }>(
        "SELECT current_database() AS db",
      );
      database_name = rows[0]?.db;
    }
    return {
      status: dbOk && schemaReady ? "ok" : "degraded",
      service: "radio-colonia-pos-api",
      database: dbOk ? "connected" : "disconnected",
      database_name,
      schema_ready: schemaReady,
    };
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: "/auth" });
      await api.register(posRoutes, { prefix: "/pos" });
      await api.register(fiscalRoutes, { prefix: "/fiscal" });
      await api.register(comprasRoutes, { prefix: "/compras" });
      await api.register(contabilidadRoutes, { prefix: "/contabilidad" });
      await api.register(clientesRoutes, { prefix: "/clientes" });
      await api.register(analyticsRoutes, { prefix: "/analytics" });
    },
    { prefix: "/api/v1" },
  );

  return app;
}

export async function startServer() {
  await logDbTarget();
  await validateConnectedDatabase();
  await assertRequiredSchema();
  await logDbTarget();
  if (!isAuthConfigured()) {
    console.warn(
      "[POS] POS_ACCESS_PIN no configurado — API abierta (solo desarrollo). En producción es obligatorio.",
    );
  } else {
    console.log("[POS] Auth por PIN habilitada");
  }
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: env.HOST });
  return app;
}
