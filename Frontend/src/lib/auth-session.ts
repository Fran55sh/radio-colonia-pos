const STORAGE_KEY = "pos-session";
const AUTH_REQUIRED_KEY = "pos-auth-required";

export type PosRole = "caja" | "compras" | "admin";

type StoredSession = {
  token: string;
  expires_at?: string;
  role?: PosRole;
};

const ROLE_RANK: Record<PosRole, number> = {
  caja: 1,
  compras: 2,
  admin: 3,
};

function readSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.token) return null;
    if (parsed.expires_at) {
      const exp = Date.parse(parsed.expires_at);
      if (!Number.isNaN(exp) && exp < Date.now()) {
        sessionStorage.removeItem(STORAGE_KEY);
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return readSession()?.token ?? null;
}

export function getRole(): PosRole | null {
  if (getAuthRequired() === false) return "admin";
  const role = readSession()?.role;
  if (role === "caja" || role === "compras" || role === "admin") return role;
  // Tokens antiguos sin role: asumir admin para no romper sesiones actuales
  return readSession()?.token ? "admin" : null;
}

export function hasRoleAtLeast(minimum: PosRole): boolean {
  const role = getRole();
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function setToken(
  token: string,
  expiresAt?: string,
  role?: PosRole,
): void {
  if (typeof window === "undefined") return;
  const payload: StoredSession = { token };
  if (expiresAt) payload.expires_at = expiresAt;
  if (role) payload.role = role;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}

/** Cache de si el backend exige PIN (false = API abierta en desarrollo). */
export function setAuthRequired(required: boolean): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(AUTH_REQUIRED_KEY, required ? "1" : "0");
}

export function getAuthRequired(): boolean | null {
  if (typeof window === "undefined") return null;
  const v = sessionStorage.getItem(AUTH_REQUIRED_KEY);
  if (v === null) return null;
  return v === "1";
}

export function clearAuthRequired(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(AUTH_REQUIRED_KEY);
}

export function isAuthenticated(): boolean {
  if (getAuthRequired() === false) return true;
  return getToken() != null;
}
