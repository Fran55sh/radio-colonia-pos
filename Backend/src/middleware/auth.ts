import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { isAuthConfigured, verifyToken } from "../modules/auth/service.js";
import { AppError } from "./errors.js";

function isPublicPath(method: string, url: string): boolean {
  const path = url.split("?")[0];
  if (method === "GET" && (path === "/health" || path.endsWith("/health"))) {
    return true;
  }
  if (method === "POST" && path === "/api/v1/auth/login") {
    return true;
  }
  if (method === "GET" && path === "/api/v1/auth/config") {
    return true;
  }
  if (method === "OPTIONS") return true;
  return false;
}

function extractBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

/**
 * Protege toda /api/v1 excepto POST /auth/login.
 * GET /health queda público.
 * Acepta JWT de sesión POS o API_TOKEN (scripts/integraciones).
 * En desarrollo sin POS_ACCESS_PIN, la API queda abierta (con warning al arrancar).
 */
export async function requireAuth(
  request: FastifyRequest,
  _reply: FastifyReply,
) {
  if (isPublicPath(request.method, request.url)) return;

  const path = request.url.split("?")[0];
  if (!path.startsWith("/api/")) return;

  // Dev sin PIN: abierto (producción siempre exige PIN vía env fail-fast)
  if (!isAuthConfigured() && env.NODE_ENV !== "production") {
    return;
  }

  const token = extractBearer(request);
  if (!token) {
    throw new AppError(401, "UNAUTHORIZED", "Token de sesión requerido");
  }

  if (env.API_TOKEN && token === env.API_TOKEN) {
    return;
  }

  verifyToken(token);
}
