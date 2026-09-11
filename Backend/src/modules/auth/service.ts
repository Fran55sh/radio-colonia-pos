import { createHmac, createHash, timingSafeEqual } from "crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/errors.js";

export type PosRole = "caja" | "compras" | "admin";

export type JwtPayload = {
  sub: string;
  role: PosRole;
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
  return "dev-pos-jwt-secret-change-me";
}

function hashPin(pin: string): Buffer {
  return createHash("sha256").update(pin, "utf8").digest();
}

function pinsEqual(expectedPin: string, actualPin: string): boolean {
  const expected = hashPin(expectedPin);
  const actual = hashPin(actualPin);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function isAuthConfigured(): boolean {
  return Boolean(env.POS_ACCESS_PIN);
}

/** Resolve which role a PIN unlocks. Admin PIN wins if both match. */
export function resolveRoleForPin(pin: string): PosRole | null {
  if (!env.POS_ACCESS_PIN) {
    throw new AppError(
      503,
      "AUTH_NOT_CONFIGURED",
      "POS_ACCESS_PIN no está configurado",
    );
  }

  if (env.POS_ADMIN_PIN && pinsEqual(env.POS_ADMIN_PIN, pin)) {
    return "admin";
  }
  if (env.POS_COMPRAS_PIN && pinsEqual(env.POS_COMPRAS_PIN, pin)) {
    return "compras";
  }
  if (pinsEqual(env.POS_ACCESS_PIN, pin)) {
    return env.POS_DEFAULT_ROLE;
  }
  return null;
}

export function verifyPin(pin: string): boolean {
  return resolveRoleForPin(pin) != null;
}

export function signToken(role: PosRole): { token: string; expiresAt: Date } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + env.POS_SESSION_HOURS * 3600;
  const header = b64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64urlEncode(
    JSON.stringify({
      sub: "pos",
      role,
      iat: now,
      exp,
    } satisfies JwtPayload),
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

  let parsed: JwtPayload & { role?: PosRole };
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

  const role = parsed.role ?? "admin";
  if (role !== "caja" && role !== "compras" && role !== "admin") {
    throw new AppError(401, "UNAUTHORIZED", "Token inválido");
  }

  return { ...parsed, role };
}

export function loginWithPin(pin: string): {
  token: string;
  expires_at: string;
  role: PosRole;
} {
  const role = resolveRoleForPin(pin);
  if (!role) {
    throw new AppError(401, "INVALID_PIN", "PIN incorrecto");
  }
  const { token, expiresAt } = signToken(role);
  return { token, expires_at: expiresAt.toISOString(), role };
}

/** In-memory lockout for login brute-force (per process). */
const loginFailures = new Map<
  string,
  { count: number; lockedUntil: number }
>();

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export function assertLoginAllowed(key: string): void {
  const entry = loginFailures.get(key);
  if (!entry) return;
  if (entry.lockedUntil > Date.now()) {
    const secs = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
    throw new AppError(
      429,
      "LOGIN_LOCKED",
      `Demasiados intentos. Reintentá en ${secs}s`,
    );
  }
}

export function recordLoginFailure(key: string): void {
  const entry = loginFailures.get(key) ?? { count: 0, lockedUntil: 0 };
  if (entry.lockedUntil > Date.now()) return;
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.count = 0;
  }
  loginFailures.set(key, entry);
}

export function clearLoginFailures(key: string): void {
  loginFailures.delete(key);
}
