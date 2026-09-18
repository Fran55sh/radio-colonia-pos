const SESION_KEY = "pos-caja-sesion-id";
const MODO_KEY = "pos-caja-modo";
export const DEFAULT_PUESTO = "Caja 01";

export type CajaModo = "principal" | "satelite";

export function getCachedCajaSesionId(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESION_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function setCachedCajaSesionId(id: number | null): void {
  if (typeof window === "undefined") return;
  if (id == null) {
    sessionStorage.removeItem(SESION_KEY);
    return;
  }
  sessionStorage.setItem(SESION_KEY, String(id));
}

export function clearCachedCajaSesionId(): void {
  setCachedCajaSesionId(null);
}

export function getCajaModo(): CajaModo {
  if (typeof window === "undefined") return "principal";
  try {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("modo");
    if (q === "satelite" || q === "principal") {
      setCajaModo(q);
      return q;
    }
    const stored = localStorage.getItem(MODO_KEY);
    if (stored === "satelite" || stored === "principal") return stored;
  } catch {
    /* ignore */
  }
  return "principal";
}

export function setCajaModo(modo: CajaModo): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(MODO_KEY, modo);
}

export function isPrincipalModo(): boolean {
  return getCajaModo() === "principal";
}
