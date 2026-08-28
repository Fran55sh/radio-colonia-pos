import { createHmac, createHash, timingSafeEqual } from "crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/errors.js";

type JwtPayload = {
  sub: string;
  iat: number;
  exp: number;
};

function b64urlEncode(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

function getJwtSecret(): string {
  if (env.POS_JWT_SECRET) return env.POS_JWT_SECRET;
  if (env.NODE_ENV === "production") {
    throw new AppError(503, "AUTH_NOT_CONFIGURED", "POS_JWT_SECRET no configurado");
  }
  // Dev fallback so local works without explicit secret when PIN is set
  return "dev-pos-jwt-secret-change-me";
}

function hashPin(pin: string): Buffer {
  return createHash("sha256").update(pin, "utf8").digest();
}

export function isAuthConfigured(): boolean {
  return Boolean(env.POS_ACCESS_PIN);
}

export function verifyPin(pin: string): boolean {
  if (!env.POS_ACCESS_PIN) {
    throw new AppError(
      503,
      "AUTH_NOT_CONFIGURED",
      "POS_ACCESS_PIN no está configurado",
    );
  }
  const expected = hashPin(env.POS_ACCESS_PIN);
  const actual = hashPin(pin);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function signToken(): { token: string; expiresAt: Date } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + env.POS_SESSION_HOURS * 3600;
  const header = b64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64urlEncode(
    JSON.stringify({ sub: "pos", iat: now, exp } satisfies JwtPayload),
  );
  const secret = getJwtSecret();
  const sig = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest();
  const token = `${header}.${payload}.${b64urlEncode(sig)}`;
  return { token, expiresAt: new Date(exp * 1000) };
}

export function verifyToken(token: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AppError(401, "UNAUTHORIZED", "Token inválido");
  }
  const [header, payload, signature] = parts;
  const secret = getJwtSecret();
  const expected = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest();
  let actual: Buffer;
  try {
    actual = b64urlDecode(signature);
  } catch {
    throw new AppError(401, "UNAUTHORIZED", "Token inválido");
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new AppError(401, "UNAUTHORIZED", "Token inválido");
  }

  let parsed: JwtPayload;
  try {
    parsed = JSON.parse(b64urlDecode(payload).toString("utf8")) as JwtPayload;
  } catch {
    throw new AppError(401, "UNAUTHORIZED", "Token inválido");
  }

  if (parsed.sub !== "pos" || typeof parsed.exp !== "number") {
    throw new AppError(401, "UNAUTHORIZED", "Token inválido");
  }
  if (parsed.exp < Math.floor(Date.now() / 1000)) {
    throw new AppError(401, "UNAUTHORIZED", "Sesión expirada");
  }
  return parsed;
}

export function loginWithPin(pin: string): { token: string; expires_at: string } {
  if (!verifyPin(pin)) {
    throw new AppError(401, "INVALID_PIN", "PIN incorrecto");
  }
  const { token, expiresAt } = signToken();
  return { token, expires_at: expiresAt.toISOString() };
}
