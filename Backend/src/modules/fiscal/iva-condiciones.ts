/** Condición IVA del receptor (códigos ARCA / RG 5616). */
export const CONDICION_IVA_RI = 1;
export const CONDICION_IVA_EXENTO = 4;
export const CONDICION_IVA_CF = 5;
export const CONDICION_IVA_MONOTRIBUTO = 6;

export const CONDICIONES_IVA_RECEPTOR = [
  { id: CONDICION_IVA_RI, label: "Responsable Inscripto" },
  { id: CONDICION_IVA_MONOTRIBUTO, label: "Monotributo" },
  { id: CONDICION_IVA_EXENTO, label: "Exento" },
  { id: CONDICION_IVA_CF, label: "Consumidor final" },
] as const;

export const CONDICION_IVA_IDS = CONDICIONES_IVA_RECEPTOR.map((c) => c.id);

export function isCondicionIvaValida(id: number): boolean {
  return CONDICION_IVA_IDS.includes(id as (typeof CONDICION_IVA_IDS)[number]);
}

export function labelCondicionIva(id: number | null | undefined): string {
  if (id == null) return "Consumidor final";
  return CONDICIONES_IVA_RECEPTOR.find((c) => c.id === id)?.label ?? "Consumidor final";
}
