import { AppError } from "../../../middleware/errors.js";

/** CAE de WSFE: 14 dígitos. Sin eso no se presenta el PDF como factura autorizada. */
export function caeValido(cae: string | null | undefined): boolean {
  return Boolean(cae && /^\d{14}$/.test(cae.trim()));
}

export function esComprobanteAutorizado(cae: string | null | undefined, estado: string): boolean {
  return estado === "emitido" && caeValido(cae);
}

export function assertFacturaAutorizada(estado: string, cae: string | null | undefined): void {
  if (estado === "anulado") {
    throw new AppError(
      409,
      "FACTURA_NO_AUTORIZADA",
      "La venta está anulada. No se presenta el PDF como factura autorizada.",
    );
  }
  if (estado === "rechazado") {
    throw new AppError(
      409,
      "FACTURA_NO_AUTORIZADA",
      "ARCA rechazó el comprobante. No es una factura autorizada.",
    );
  }
  if (estado === "enviando" || estado === "desconocido") {
    throw new AppError(
      409,
      "FACTURA_NO_AUTORIZADA",
      "El comprobante está pendiente de confirmación con ARCA.",
    );
  }
  if (estado === "pendiente" || estado === "error" || !cae) {
    throw new AppError(
      409,
      "FACTURA_NO_AUTORIZADA",
      "El comprobante no tiene CAE. No se puede presentar como factura autorizada.",
    );
  }
  if (!esComprobanteAutorizado(cae, estado)) {
    throw new AppError(
      409,
      "FACTURA_NO_AUTORIZADA",
      "Solo se imprime una factura con CAE válido de 14 dígitos.",
    );
  }
}
