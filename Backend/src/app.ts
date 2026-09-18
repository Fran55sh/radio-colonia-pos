import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { checkDbConnection } from "./config/db.js";
import {
  assertRequiredSchema,
  isSchemaReady,
  logDbTarget,
  validateConnectedDatabase,
} from "./db/verify-schema.js";
import { env } from "./config/env.js";
import { warnIfArcaEnabledButIncomplete } from "./config/arca.js";
import { errorHandler } from "./middleware/errors.js";
import { requireAuth, requireRole } from "./middleware/auth.js";
import { analyticsRoutes } from "./modules/analytics/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { isAuthConfigured } from "./modules/auth/service.js";
import { clientesRoutes } from "./modules/clientes/routes.js";
import { comprasRoutes } from "./modules/compras/routes.js";
import { contabilidadRoutes } from "./modules/contabilidad/routes.js";
import { fiscalRoutes } from "./modules/fiscal/routes.js";
import { cajaRoutes } from "./modules/caja/routes.js";
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
  const app = Fastify({
    logger: true,
    trustProxy: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()),
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });

  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: "1 minute",
  });

  await app.register(multipart, {
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  });

  await ensurePdfStorageDir();

  app.addHook("preHandler", requireAuth);
  app.setErrorHandler(errorHandler);

  app.get("/health", async () => {
    await refreshHealthCache();
    const { dbOk } = healthCache;
    const schemaReady = isSchemaReady();
    return {
      status: dbOk && schemaReady ? "ok" : "degraded",
      service: "radio-colonia-pos-api",
      database: dbOk ? "connected" : "disconnected",
      schema_ready: schemaReady,
    };
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: "/auth" });
      await api.register(posRoutes, { prefix: "/pos" });
      await api.register(
        async (scoped) => {
          scoped.addHook("preHandler", requireRole("caja"));
          await scoped.register(cajaRoutes);
        },
        { prefix: "/caja" },
      );
      await api.register(
        async (scoped) => {
          scoped.addHook("preHandler", requireRole("caja"));
          await scoped.register(fiscalRoutes);
        },
        { prefix: "/fiscal" },
      );
      await api.register(
        async (scoped) => {
          scoped.addHook("preHandler", requireRole("compras"));
          await scoped.register(comprasRoutes);
        },
        { prefix: "/compras" },
      );
      await api.register(
        async (scoped) => {
          scoped.addHook("preHandler", requireRole("admin"));
          await scoped.register(contabilidadRoutes);
        },
        { prefix: "/contabilidad" },
      );
      await api.register(
        async (scoped) => {
          scoped.addHook("preHandler", requireRole("caja"));
          await scoped.register(clientesRoutes);
        },
        { prefix: "/clientes" },
      );
      await api.register(
        async (scoped) => {
          scoped.addHook("preHandler", requireRole("admin"));
          await scoped.register(analyticsRoutes);
        },
        { prefix: "/analytics" },
      );
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
  warnIfArcaEnabledButIncomplete();
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: env.HOST });
  return app;
}
