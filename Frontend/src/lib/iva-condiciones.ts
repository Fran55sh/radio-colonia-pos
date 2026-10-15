/** Condición IVA del receptor (códigos ARCA / RG 5616). */
export const CONDICION_IVA_RI = 1;
export const CONDICION_IVA_EXENTO = 4;
export const CONDICION_IVA_CF = 5;
export const CONDICION_IVA_MONOTRIBUTO = 6;
export const CONDICION_IVA_NO_CATEGORIZADO = 7;
export const CONDICION_IVA_MONOTRIBUTO_SOCIAL = 13;
export const CONDICION_IVA_MONOTRIBUTO_TIP = 16;

const CONDICIONES_IVA_FACTURA_A = [
  CONDICION_IVA_RI,
  CONDICION_IVA_MONOTRIBUTO,
  CONDICION_IVA_MONOTRIBUTO_SOCIAL,
  CONDICION_IVA_MONOTRIBUTO_TIP,
] as const;

export const CONDICIONES_IVA_RECEPTOR = [
  { id: CONDICION_IVA_RI, label: "Responsable Inscripto" },
  { id: CONDICION_IVA_MONOTRIBUTO, label: "Monotributo" },
  { id: CONDICION_IVA_MONOTRIBUTO_SOCIAL, label: "Monotributo Social" },
  {
    id: CONDICION_IVA_MONOTRIBUTO_TIP,
    label: "Monotributista Trabajador Independiente Promovido",
  },
  { id: CONDICION_IVA_EXENTO, label: "Exento" },
  { id: CONDICION_IVA_NO_CATEGORIZADO, label: "Sujeto no categorizado" },
  { id: CONDICION_IVA_CF, label: "Consumidor final" },
] as const;

export function labelCondicionIva(id: number | null | undefined): string {
  if (id == null) return "Consumidor final";
  return CONDICIONES_IVA_RECEPTOR.find((c) => c.id === id)?.label ?? "Consumidor final";
}

/** RI y variantes de Monotributo (RG 5003/2021) → Factura A. */
export function requiereFacturaA(condicionIva: number | null | undefined): boolean {
  if (condicionIva == null) return false;
  return (CONDICIONES_IVA_FACTURA_A as readonly number[]).includes(condicionIva);
}
