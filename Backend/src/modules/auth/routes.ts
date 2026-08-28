import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../middleware/errors.js";
import { isAuthConfigured, loginWithPin, verifyToken } from "./service.js";

const loginSchema = z.object({
  pin: z.string().min(4).max(64),
});

export async function authRoutes(app: FastifyInstance) {
  app.get("/config", async (_request, reply) => {
    return reply.send({
      auth_required: isAuthConfigured(),
    });
  });

  app.post("/login", async (request, reply) => {
    if (!isAuthConfigured()) {
      throw new AppError(
        503,
        "AUTH_NOT_CONFIGURED",
        "POS_ACCESS_PIN no está configurado en el servidor",
      );
    }
    const body = loginSchema.parse(request.body);
    const result = loginWithPin(body.pin);
    return reply.send(result);
  });

  app.get("/session", async (request, reply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      throw new AppError(401, "UNAUTHORIZED", "Token ausente");
    }
    const payload = verifyToken(token);
    return reply.send({
      authenticated: true,
      expires_at: new Date(payload.exp * 1000).toISOString(),
    });
  });
}
