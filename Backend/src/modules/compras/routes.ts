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
  listProveedores,
  mapProductoProveedor,
} from "./service.js";

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
}
