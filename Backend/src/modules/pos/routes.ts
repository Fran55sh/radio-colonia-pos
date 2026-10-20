import type { FastifyInstance } from "fastify";
import { pool } from "../../config/db.js";
import { detalleVenta, listarVentas } from "./consultas.js";
import { createSaleSchema, offlineBatchSchema } from "./schemas.js";
import { listProductosCaja, processOfflineBatch, processSale } from "./service.js";

export async function posRoutes(app: FastifyInstance) {
  app.get("/ventas", async (request, reply) => {
    const query = request.query as { limit?: string; before?: string };
    const parsed = Number(query.limit ?? 40);
    const limit = Number.isInteger(parsed) ? Math.min(100, Math.max(1, parsed)) : 40;
    const before = query.before == null ? null : Number(query.before);
    if (before != null && (!Number.isSafeInteger(before) || before <= 0 || before > 2147483647)) {
      return reply.status(400).send({ error: "VALIDATION_ERROR", message: "Cursor de ventas inválido" });
    }
    return reply.send(await listarVentas(limit, before));
  });

  app.get("/ventas/:ventaId", async (request, reply) => {
    const { ventaId } = request.params as { ventaId: string };
    const id = Number(ventaId);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.status(400).send({ error: "VALIDATION_ERROR", message: "Venta inválida" });
    }
    return reply.send(await detalleVenta(id));
  });

  app.get("/productos", async (_request, reply) => {
    const client = await pool.connect();
    try {
      const productos = await listProductosCaja(client);
      return reply.send({ productos });
    } finally {
      client.release();
    }
  });

  app.post("/ventas", async (request, reply) => {
    const body = createSaleSchema.parse(request.body);
    const result = await processSale(body, {
      authContext: request.authContext,
    });
    return reply.status(result.duplicada ? 200 : 201).send(result);
  });

  app.post("/ventas/offline-batch", async (request, reply) => {
    const body = offlineBatchSchema.parse(request.body);
    const result = await processOfflineBatch(body.ventas, request.authContext);
    return reply.send(result);
  });
}
