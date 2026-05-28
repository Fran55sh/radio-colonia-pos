import type { FastifyInstance } from "fastify";
import {
  alertasStockCritico,
  facturacionDelDia,
  productosMasVendidos,
  rentabilidadEstimada,
} from "./service.js";

export async function analyticsRoutes(app: FastifyInstance) {
  app.get("/facturacion-dia", async (request, reply) => {
    const { fecha } = request.query as { fecha?: string };
    return reply.send(await facturacionDelDia(fecha));
  });

  app.get("/ranking-productos", async (request, reply) => {
    const { limit, dias } = request.query as { limit?: string; dias?: string };
    return reply.send({
      ranking: await productosMasVendidos(
        limit ? Number(limit) : 10,
        dias ? Number(dias) : 30,
      ),
    });
  });

  app.get("/stock-critico", async (_req, reply) => {
    return reply.send({ alertas: await alertasStockCritico() });
  });

  app.get("/rentabilidad", async (request, reply) => {
    const { dias } = request.query as { dias?: string };
    return reply.send({
      productos: await rentabilidadEstimada(dias ? Number(dias) : 30),
    });
  });
}
