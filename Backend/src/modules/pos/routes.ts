import type { FastifyInstance } from "fastify";
import { pool } from "../../config/db.js";
import {
  applyPosSchema,
  ensurePosSchema,
  isMissingPosTableError,
} from "../../db/ensure-pos-schema.js";
import { createSaleSchema, offlineBatchSchema } from "./schemas.js";
import { listProductosCaja, processOfflineBatch, processSale } from "./service.js";

let posSchemaChecked = false;

async function ensurePosSchemaOnce(): Promise<void> {
  if (posSchemaChecked) return;
  await ensurePosSchema();
  posSchemaChecked = true;
}

async function runSaleWithSchemaRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingPosTableError(err)) throw err;
    console.warn("[POS] pos_ventas ausente en venta; reaplicando schema...");
    await applyPosSchema();
    posSchemaChecked = true;
    return await fn();
  }
}

export async function posRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async () => {
    await ensurePosSchemaOnce();
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
    const result = await runSaleWithSchemaRetry(() => processSale(body));
    return reply.status(201).send(result);
  });

  app.post("/ventas/offline-batch", async (request, reply) => {
    const body = offlineBatchSchema.parse(request.body);
    const result = await runSaleWithSchemaRetry(() => processOfflineBatch(body.ventas));
    return reply.send(result);
  });
}
