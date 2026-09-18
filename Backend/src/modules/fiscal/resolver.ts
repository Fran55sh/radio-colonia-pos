import { CbteTipo, DocTipo } from "@ramiidv/arca-facturacion";
import { AppError } from "../../middleware/errors.js";
import type { ClienteFiscal } from "./types.js";
import {
  CONDICION_IVA_CF,
  CONDICION_IVA_RI,
  labelCondicionIva,
} from "./iva-condiciones.js";

export { CONDICION_IVA_CF, CONDICION_IVA_RI } from "./iva-condiciones.js";
export {
  CONDICION_IVA_EXENTO,
  CONDICION_IVA_MONOTRIBUTO,
  CONDICIONES_IVA_RECEPTOR,
} from "./iva-condiciones.js";

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
      label: `Factura B — ${labelCondicionIva(condicion)}`,
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
