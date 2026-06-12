import { CbteTipo, DocTipo } from "@ramiidv/arca-facturacion";
import { AppError } from "../../middleware/errors.js";
import type { ClienteFiscal } from "./types.js";

/** Condición IVA ARCA: 1 = Responsable Inscripto, 5 = Consumidor Final */
export const CONDICION_IVA_RI = 1;
export const CONDICION_IVA_CF = 5;

export type ComprobanteResuelto = {
  cbteTipo: number;
  docTipo: number;
  docNro: number;
  condicionIva: number;
  label: string;
};

function normalizeCuit(documento: string | null): string | null {
  if (!documento) return null;
  const digits = documento.replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

export function resolverComprobante(cliente: ClienteFiscal | null): ComprobanteResuelto {
  if (!cliente) {
    return {
      cbteTipo: CbteTipo.FACTURA_B,
      docTipo: DocTipo.CONSUMIDOR_FINAL,
      docNro: 0,
      condicionIva: CONDICION_IVA_CF,
      label: "Factura B — Consumidor final",
    };
  }

  const cuit = normalizeCuit(cliente.documento);
  const condicion =
    cliente.condicion_iva_receptor_id ?? CONDICION_IVA_CF;

  if (cuit && condicion === CONDICION_IVA_RI) {
    return {
      cbteTipo: CbteTipo.FACTURA_A,
      docTipo: DocTipo.CUIT,
      docNro: Number(cuit),
      condicionIva: CONDICION_IVA_RI,
      label: "Factura A",
    };
  }

  if (cuit) {
    return {
      cbteTipo: CbteTipo.FACTURA_B,
      docTipo: DocTipo.CUIT,
      docNro: Number(cuit),
      condicionIva: condicion,
      label: "Factura B",
    };
  }

  return {
    cbteTipo: CbteTipo.FACTURA_B,
    docTipo: DocTipo.CONSUMIDOR_FINAL,
    docNro: 0,
    condicionIva: CONDICION_IVA_CF,
    label: "Factura B — Consumidor final",
  };
}

export function validarClienteParaFacturaA(cliente: ClienteFiscal): void {
  const cuit = normalizeCuit(cliente.documento);
  if (!cuit) {
    throw new AppError(
      400,
      "CLIENTE_SIN_CUIT",
      "Factura A requiere un CUIT válido en el cliente",
    );
  }
  if (cliente.condicion_iva_receptor_id !== CONDICION_IVA_RI) {
    throw new AppError(
      400,
      "CLIENTE_SIN_CONDICION_RI",
      "Factura A requiere condición IVA Responsable Inscripto (código 1)",
    );
  }
}
