import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import {
  isAuthConfigured,
  type PosRole,
  verifyToken,
} from "../modules/auth/service.js";
import { AppError } from "./errors.js";

export type AuthContext = {
  role: PosRole;
  sub: string;
  via: "jwt" | "api_token" | "dev_open";
};

declare module "fastify" {
  interface FastifyRequest {
    authContext?: AuthContext;
  }
}

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

const ROLE_RANK: Record<PosRole, number> = {
  caja: 1,
  compras: 2,
  admin: 3,
};

export function roleAtLeast(role: PosRole, minimum: PosRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/**
 * Protege toda /api/v1 excepto POST /auth/login.
 * GET /health queda público.
 * Acepta JWT de sesión POS o API_TOKEN (scripts/integraciones → rol admin).
 */
export async function requireAuth(
  request: FastifyRequest,
  _reply: FastifyReply,
) {
  if (isPublicPath(request.method, request.url)) return;

  const path = request.url.split("?")[0];
  if (!path.startsWith("/api/")) return;

  if (!isAuthConfigured() && env.NODE_ENV !== "production") {
    request.authContext = { role: "admin", sub: "dev", via: "dev_open" };
    return;
  }

  const token = extractBearer(request);
  if (!token) {
    throw new AppError(401, "UNAUTHORIZED", "Token de sesión requerido");
  }

  if (env.API_TOKEN && token === env.API_TOKEN) {
    request.authContext = { role: "admin", sub: "api_token", via: "api_token" };
    return;
  }

  const payload = verifyToken(token);
  request.authContext = {
    role: payload.role,
    sub: payload.sub,
    via: "jwt",
  };
}

/** Exige rol mínimo (caja < compras < admin). */
export function requireRole(minimum: PosRole) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const ctx = request.authContext;
    if (!ctx) {
      throw new AppError(401, "UNAUTHORIZED", "Token de sesión requerido");
    }
    if (!roleAtLeast(ctx.role, minimum)) {
      throw new AppError(
        403,
        "FORBIDDEN",
        `Se requiere rol ${minimum} o superior`,
      );
    }
  };
}
