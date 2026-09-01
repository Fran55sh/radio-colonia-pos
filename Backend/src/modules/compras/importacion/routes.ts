import type { FastifyInstance } from "fastify";
import { AppError } from "../../../middleware/errors.js";
import { createImportacionTextSchema, patchImportacionSchema } from "./schemas.js";
import {
  cancelImportacion,
  createImportacionFromPdf,
  createImportacionFromText,
  createImportacionManual,
  executeImportacion,
  getImportacion,
  listImportaciones,
  updateImportacionReview,
} from "./service.js";

export async function importacionRoutes(app: FastifyInstance) {
  app.get("/", async (request, reply) => {
    const q = request.query as { limit?: string };
    const limit = Math.min(Number(q.limit) || 50, 100);
    return reply.send({ importaciones: await listImportaciones(limit) });
  });

  app.post("/", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      throw new AppError(400, "NO_FILE", "Adjuntá un archivo PDF en el campo 'file'");
    }
    const buffer = await file.toBuffer();
    const result = await createImportacionFromPdf({
      filename: file.filename,
      mimetype: file.mimetype,
      buffer,
    });
    return reply.status(201).send(result);
  });

  app.post("/texto", async (request, reply) => {
    const body = createImportacionTextSchema.parse(request.body);
    const result = await createImportacionFromText(body);
    return reply.status(201).send(result);
  });

  app.post("/manual", async (_request, reply) => {
    const result = await createImportacionManual();
    return reply.status(201).send(result);
  });

  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await getImportacion(Number(id));
    if (!row) return reply.status(404).send({ error: "NOT_FOUND" });
    return reply.send(row);
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = patchImportacionSchema.parse(request.body);
    const row = await updateImportacionReview(Number(id), body.review_json);
    return reply.send(row);
  });

  app.post("/:id/ejecutar", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await executeImportacion(Number(id), "pos");
    return reply.send(result);
  });

  app.post("/:id/cancelar", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await cancelImportacion(Number(id));
    return reply.send(row);
  });
}
