import { CbteTipo, NOTA_CREDITO_MAP, NOTA_DEBITO_MAP } from "@ramiidv/arca-facturacion";
import { requiereFacturaA } from "./iva-condiciones.js";

/**
 * Tipo de factura (A/B) según condición IVA del receptor.
 * Emisor Responsable Inscripto — RG 5003/2021:
 * RI y Monotributo (6 / 13 / 16) → Factura A (1);
 * CF, Exento, No Responsable, No Categorizado → Factura B (6).
 */
export function cbteTipoPorCondicionIva(condicionIva: number): number {
  return requiereFacturaA(condicionIva) ? CbteTipo.FACTURA_A : CbteTipo.FACTURA_B;
}

export function esLetraA(cbteTipo: number): boolean {
  return (
    cbteTipo === CbteTipo.FACTURA_A ||
    cbteTipo === CbteTipo.NOTA_DEBITO_A ||
    cbteTipo === CbteTipo.NOTA_CREDITO_A ||
    cbteTipo === CbteTipo.RECIBO_A ||
    cbteTipo === CbteTipo.NOTA_VENTA_CONTADO_A
  );
}

/** NC asociada: misma letra que el comprobante original (Factura A → NC A tipo 3). */
export function cbteTipoNotaCredito(cbteTipoOriginal: number): number {
  const mapped = NOTA_CREDITO_MAP[cbteTipoOriginal];
  if (mapped != null) return mapped;
  return esLetraA(cbteTipoOriginal) ? CbteTipo.NOTA_CREDITO_A : CbteTipo.NOTA_CREDITO_B;
}

/** ND asociada: misma letra que el comprobante original (Factura A → ND A tipo 2). */
export function cbteTipoNotaDebito(cbteTipoOriginal: number): number {
  const mapped = NOTA_DEBITO_MAP[cbteTipoOriginal];
  if (mapped != null) return mapped;
  return esLetraA(cbteTipoOriginal) ? CbteTipo.NOTA_DEBITO_A : CbteTipo.NOTA_DEBITO_B;
}

/**
 * Factura A / NC A / ND A (y B) discriminan IVA (ImpNeto + ImpIVA).
 * Tipo C (emisor monotributista) no discrimina; el POS emite A/B como RI.
 */
export function discriminaIva(cbteTipo: number): boolean {
  switch (cbteTipo) {
    case CbteTipo.FACTURA_C:
    case CbteTipo.NOTA_DEBITO_C:
    case CbteTipo.NOTA_CREDITO_C:
    case CbteTipo.RECIBO_C:
    case CbteTipo.FCE_FACTURA_C:
    case CbteTipo.FCE_NOTA_DEBITO_C:
    case CbteTipo.FCE_NOTA_CREDITO_C:
      return false;
    default:
      return true;
  }
}
