import cors from "@fastify/cors";
import Fastify from "fastify";
import { checkDbConnection } from "./config/db.js";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errors.js";
import { optionalApiToken } from "./middleware/auth.js";
import { analyticsRoutes } from "./modules/analytics/routes.js";
import { clientesRoutes } from "./modules/clientes/routes.js";
import { comprasRoutes } from "./modules/compras/routes.js";
import { contabilidadRoutes } from "./modules/contabilidad/routes.js";
import { posRoutes } from "./modules/pos/routes.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()),
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });

  app.addHook("preHandler", optionalApiToken);
  app.setErrorHandler(errorHandler);

  app.get("/health", async () => {
    const dbOk = await checkDbConnection();
    return {
      status: dbOk ? "ok" : "degraded",
      service: "radio-colonia-pos-api",
      database: dbOk ? "connected" : "disconnected",
    };
  });

  await app.register(
    async (api) => {
      await api.register(posRoutes, { prefix: "/pos" });
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
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: env.HOST });
  return app;
}
