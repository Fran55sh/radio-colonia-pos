import type { FiscalEstado } from "./types.js";

const PUEDE_ENVIAR: ReadonlySet<FiscalEstado> = new Set(["pendiente", "rechazado", "error"]);

const TRANSICIONES: Record<FiscalEstado, readonly FiscalEstado[]> = {
  pendiente: ["enviando", "error"],
  rechazado: ["enviando"],
  error: ["enviando"],
  enviando: ["emitido", "rechazado", "desconocido", "error"],
  desconocido: ["emitido", "rechazado"],
  emitido: [],
  anulado: [],
};

export function puedeEnviarAArca(estado: FiscalEstado): boolean {
  return PUEDE_ENVIAR.has(estado);
}

export function transicionPermitida(desde: FiscalEstado, hacia: FiscalEstado): boolean {
  if (desde === "emitido") return false;
  return TRANSICIONES[desde].includes(hacia);
}

export function puedeReintentar(estado: FiscalEstado, cae: string | null): boolean {
  return !cae && puedeEnviarAArca(estado);
}

export function requiereConciliacion(estado: FiscalEstado): boolean {
  return estado === "enviando" || estado === "desconocido";
}
