import type { FastifyInstance } from "fastify";
import { requireRole } from "../../middleware/auth.js";
import {
  actualQuerySchema,
  closeSessionSchema,
  listMovimientosQuerySchema,
  manualMovementSchema,
  openSessionSchema,
} from "./schemas.js";
import {
  anularMovimientoManual,
  abrirSesion,
  cerrarSesion,
  crearMovimientoManual,
  getResumen,
  getSesionActual,
  getSesionDetalle,
  listMovimientosSesion,
} from "./service.js";

export async function cajaRoutes(app: FastifyInstance) {
  app.get("/sesiones/actual", async (request, reply) => {
    const query = actualQuerySchema.parse(request.query);
    return reply.send(await getSesionActual(query.puesto));
  });

  app.post("/sesiones/abrir", async (request, reply) => {
    const body = openSessionSchema.parse(request.body);
    const result = await abrirSesion(body, request.authContext);
    return reply.status(201).send(result);
  });

  app.get("/sesiones/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await getSesionDetalle(Number(id)));
  });

  app.get("/sesiones/:id/movimientos", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = listMovimientosQuerySchema.parse(request.query);
    return reply.send(
      await listMovimientosSesion(Number(id), query.limit, query.offset),
    );
  });

  app.get("/sesiones/:id/resumen", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await getResumen(Number(id)));
  });

  app.post("/movimientos", async (request, reply) => {
    const body = manualMovementSchema.parse(request.body);
    const result = await crearMovimientoManual(body, request.authContext);
    return reply.status(201).send(result);
  });

  app.post("/sesiones/:id/cerrar", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = closeSessionSchema.parse(request.body);
    return reply.send(await cerrarSesion(Number(id), body, request.authContext));
  });

  app.post(
    "/movimientos/:id/anular",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { motivo?: string };
      return reply.send(
        await anularMovimientoManual(
          Number(id),
          request.authContext,
          body.motivo,
        ),
      );
    },
  );
}
