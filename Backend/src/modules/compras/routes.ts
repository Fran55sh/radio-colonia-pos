import type { FastifyInstance } from "fastify";
import {
  createOrdenCompraSchema,
  createProveedorSchema,
  mapProductoProveedorSchema,
} from "./schemas.js";
import {
  createOrdenCompra,
  createProveedor,
  getOrdenCompra,
  listOrdenesCompra,
  listProveedores,
  mapProductoProveedor,
} from "./service.js";
import { importacionRoutes } from "./importacion/routes.js";

export async function comprasRoutes(app: FastifyInstance) {
  app.get("/proveedores", async (_req, reply) => {
    return reply.send({ proveedores: await listProveedores() });
  });

  app.post("/proveedores", async (request, reply) => {
    const body = createProveedorSchema.parse(request.body);
    const proveedor = await createProveedor(body);
    return reply.status(201).send(proveedor);
  });

  app.post("/proveedores-productos", async (request, reply) => {
    const body = mapProductoProveedorSchema.parse(request.body);
    const mapping = await mapProductoProveedor(body);
    return reply.status(201).send(mapping);
  });

  app.get("/ordenes", async (request, reply) => {
    const q = request.query as { limit?: string };
    const limit = Math.min(Number(q.limit) || 50, 100);
    return reply.send({ ordenes: await listOrdenesCompra(limit) });
  });

  app.post("/ordenes", async (request, reply) => {
    const body = createOrdenCompraSchema.parse(request.body);
    const orden = await createOrdenCompra(body);
    return reply.status(201).send(orden);
  });

  app.get("/ordenes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const orden = await getOrdenCompra(Number(id));
    if (!orden) return reply.status(404).send({ error: "NOT_FOUND" });
    return reply.send(orden);
  });

  await app.register(importacionRoutes, { prefix: "/importaciones" });
}
