import type { FastifyInstance } from "fastify";
import { getArcaConfig, getArcaDiagnostics, isArcaConfigured } from "../../config/arca.js";
import { AppError } from "../../middleware/errors.js";
import { getArcaClient } from "./arca-client.js";
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

  /** Probe WSAA/WSFE en el mismo proceso que la caja (no usar npm run arca:check en paralelo). */
  app.get("/wsaa-ping", async (_request, reply) => {
    if (!isArcaConfigured()) {
      throw new AppError(503, "ARCA_DISABLED", "Facturación ARCA no configurada");
    }
    const arca = getArcaClient();
    const config = getArcaConfig();
    if (!arca || !config) {
      throw new AppError(503, "ARCA_DISABLED", "Facturación ARCA no configurada");
    }
    const ultimo = await arca.ultimoComprobante(config.ptoVta, 6);
    return reply.send({
      ok: true,
      ultimo_factura_b: ultimo,
      punto_venta: config.ptoVta,
      ambiente: config.ambiente,
    });
  });

  app.get("/config", async (_request, reply) => {
    const config = getArcaConfig();
    const diagnostics = getArcaDiagnostics();
    return reply.send({
      arca_enabled: config !== null,
      production: config ? config.production : null,
      ambiente: config ? config.ambiente : null,
      ...diagnostics,
    });
  });
}
