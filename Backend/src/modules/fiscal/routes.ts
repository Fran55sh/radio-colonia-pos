import type { FastifyInstance } from "fastify";
import { getArcaConfig, isArcaConfigured } from "../../config/arca.js";
import { AppError } from "../../middleware/errors.js";
import { getFiscalStatus, reintentarComprobante } from "./service.js";

export async function fiscalRoutes(app: FastifyInstance) {
  app.get("/ventas/:ventaId", async (request, reply) => {
    const { ventaId } = request.params as { ventaId: string };
    const fiscal = await getFiscalStatus(Number(ventaId));
    if (!fiscal) {
      return reply.status(404).send({
        error: "NOT_FOUND",
        message: "Sin comprobante fiscal para esta venta",
      });
    }
    return reply.send({ fiscal });
  });

  app.post("/ventas/:ventaId/reintentar", async (request, reply) => {
    if (!isArcaConfigured()) {
      throw new AppError(503, "ARCA_DISABLED", "Facturación ARCA no configurada");
    }
    const { ventaId } = request.params as { ventaId: string };
    const fiscal = await reintentarComprobante(Number(ventaId));
    return reply.send({ fiscal });
  });

  app.get("/config", async (_request, reply) => {
    const config = getArcaConfig();
    return reply.send({
      arca_enabled: config !== null,
      production: config ? config.production : null,
      ambiente: config ? config.ambiente : null,
    });
  });
}
