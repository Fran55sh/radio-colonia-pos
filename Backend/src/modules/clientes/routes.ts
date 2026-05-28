import type { FastifyInstance } from "fastify";
import { createClienteSchema, updateClienteSchema } from "./schemas.js";
import {
  createCliente,
  getCliente,
  historialCompras,
  listClientes,
  updateCliente,
} from "./service.js";

export async function clientesRoutes(app: FastifyInstance) {
  app.get("/", async (_req, reply) => {
    return reply.send({ clientes: await listClientes() });
  });

  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await getCliente(Number(id)));
  });

  app.post("/", async (request, reply) => {
    const body = createClienteSchema.parse(request.body);
    const cliente = await createCliente(body);
    return reply.status(201).send(cliente);
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateClienteSchema.parse(request.body);
    return reply.send(await updateCliente(Number(id), body));
  });

  app.get("/:id/historial", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send({ ventas: await historialCompras(Number(id)) });
  });
}
