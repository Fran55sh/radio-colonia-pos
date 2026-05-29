import type { FastifyInstance } from "fastify";
import { pool } from "../../config/db.js";
import { createSaleSchema, offlineBatchSchema } from "./schemas.js";
import { listProductosCaja, processOfflineBatch, processSale } from "./service.js";

export async function posRoutes(app: FastifyInstance) {
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
    const result = await processSale(body);
    return reply.status(201).send(result);
  });

  app.post("/ventas/offline-batch", async (request, reply) => {
    const body = offlineBatchSchema.parse(request.body);
    const result = await processOfflineBatch(body.ventas);
    return reply.send(result);
  });
}
