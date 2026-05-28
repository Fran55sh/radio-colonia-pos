import type { FastifyInstance } from "fastify";
import { createFacturaCompraSchema } from "./schemas.js";
import {
  libroIvaCompras,
  libroIvaVentas,
  registrarFacturaCompra,
} from "./service.js";

export async function contabilidadRoutes(app: FastifyInstance) {
  app.get("/iva/ventas", async (request, reply) => {
    const { desde, hasta } = request.query as { desde?: string; hasta?: string };
    return reply.send({ registros: await libroIvaVentas(desde, hasta) });
  });

  app.get("/iva/compras", async (request, reply) => {
    const { desde, hasta } = request.query as { desde?: string; hasta?: string };
    return reply.send({ registros: await libroIvaCompras(desde, hasta) });
  });

  app.post("/iva/compras/facturas", async (request, reply) => {
    const body = createFacturaCompraSchema.parse(request.body);
    const result = await registrarFacturaCompra(body);
    return reply.status(201).send(result);
  });
}
