import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { AppError } from "./errors.js";

/** Si API_TOKEN está definido, exige Authorization: Bearer <token> en métodos de escritura. */
export async function optionalApiToken(
  request: FastifyRequest,
  _reply: FastifyReply,
) {
  if (!env.API_TOKEN) return;
  if (request.method === "GET" || request.method === "HEAD") return;

  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (token !== env.API_TOKEN) {
    throw new AppError(401, "UNAUTHORIZED", "Token de API inválido o ausente");
  }
}
