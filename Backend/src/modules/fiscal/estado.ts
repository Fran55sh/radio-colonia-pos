import type { FiscalEstado } from "./types.js";

const PUEDE_ENVIAR: ReadonlySet<FiscalEstado> = new Set(["pendiente", "rechazado", "error"]);
const PUEDE_ELIMINAR: ReadonlySet<FiscalEstado> = new Set(["pendiente", "rechazado", "error"]);

const TRANSICIONES: Record<FiscalEstado, readonly FiscalEstado[]> = {
  pendiente: ["enviando", "error", "anulado"],
  rechazado: ["enviando", "anulado"],
  error: ["enviando", "anulado"],
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

/** Venta cobrada sin CAE y sin un envío a ARCA todavía sin confirmar. */
export function puedeEliminarSinFactura(estado: FiscalEstado, cae: string | null): boolean {
  return !cae && PUEDE_ELIMINAR.has(estado);
}

export function requiereConciliacion(estado: FiscalEstado): boolean {
  return estado === "enviando" || estado === "desconocido";
}
