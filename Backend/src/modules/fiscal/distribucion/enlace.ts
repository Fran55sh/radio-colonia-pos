import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "../../../middleware/errors.js";

const MAX_TTL_SECONDS = 7 * 24 * 3600;

export function secretoEnlace(source: NodeJS.ProcessEnv = process.env): string | null {
  const dedicated = source.INVOICE_SHARE_SECRET?.trim();
  if (dedicated && dedicated.length >= 16) return dedicated;
  const jwt = source.POS_JWT_SECRET?.trim();
  if (jwt && jwt.length >= 16) return jwt;
  return null;
}

export function ttlEnlaceSegundos(source: NodeJS.ProcessEnv = process.env): number {
  const hours = Number(source.INVOICE_SHARE_TTL_HOURS ?? 72);
  const safe = Number.isFinite(hours) && hours > 0 ? hours : 72;
  return Math.round(Math.min(safe, MAX_TTL_SECONDS / 3600) * 3600);
}

export function crearEnlaceToken(ventaId: number, expEpochSec: number, secret: string): string {
  const body = Buffer.from(JSON.stringify({ v: ventaId, e: expEpochSec }), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verificarEnlaceToken(
  token: string,
  secret: string,
  nowSec: number,
): { ventaId: number } {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new AppError(401, "ENLACE_INVALIDO", "El enlace no es válido");
  }
  const [body, sig] = parts;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const actualBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    throw new AppError(401, "ENLACE_INVALIDO", "El enlace no es válido");
  }
  let parsed: { v?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { v?: unknown; e?: unknown };
  } catch {
    throw new AppError(401, "ENLACE_INVALIDO", "El enlace no es válido");
  }
  if (typeof parsed.v !== "number" || !Number.isInteger(parsed.v) || parsed.v <= 0) {
    throw new AppError(401, "ENLACE_INVALIDO", "El enlace no es válido");
  }
  if (typeof parsed.e !== "number" || parsed.e < nowSec) {
    throw new AppError(410, "ENLACE_VENCIDO", "El enlace venció");
  }
  return { ventaId: parsed.v };
}
