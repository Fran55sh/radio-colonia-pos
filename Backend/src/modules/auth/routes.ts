import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../middleware/errors.js";
import {
  assertLoginAllowed,
  clearLoginFailures,
  isAuthConfigured,
  loginWithPin,
  recordLoginFailure,
  verifyToken,
} from "./service.js";

const loginSchema = z.object({
  pin: z.string().min(4).max(64),
});

function clientKey(request: { ip: string; headers: Record<string, unknown> }): string {
  const fwd = request.headers["x-forwarded-for"];
  const forwarded =
    typeof fwd === "string" ? fwd.split(",")[0]?.trim() : undefined;
  return forwarded || request.ip || "unknown";
}

export async function authRoutes(app: FastifyInstance) {
  app.get("/config", async (_request, reply) => {
    return reply.send({
      auth_required: isAuthConfigured(),
    });
  });

  app.post(
    "/login",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      if (!isAuthConfigured()) {
        throw new AppError(
          503,
          "AUTH_NOT_CONFIGURED",
          "POS_ACCESS_PIN no está configurado en el servidor",
        );
      }
      const key = clientKey(request);
      assertLoginAllowed(key);

      const body = loginSchema.parse(request.body);
      try {
        const result = loginWithPin(body.pin);
        clearLoginFailures(key);
        return reply.send(result);
      } catch (err) {
        if (err instanceof AppError && err.code === "INVALID_PIN") {
          recordLoginFailure(key);
        }
        throw err;
      }
    },
  );

  app.get("/session", async (request, reply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      throw new AppError(401, "UNAUTHORIZED", "Token ausente");
    }
    const payload = verifyToken(token);
    return reply.send({
      authenticated: true,
      role: payload.role,
      expires_at: new Date(payload.exp * 1000).toISOString(),
    });
  });
}
