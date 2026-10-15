import { CbteTipo, DocTipo } from "@ramiidv/arca-facturacion";
import { AppError } from "../../middleware/errors.js";
import type { ClienteFiscal } from "./types.js";
import { cbteTipoPorCondicionIva } from "./cbte-tipo.js";
import {
  CONDICION_IVA_CF,
  labelCondicionIva,
  requiereFacturaA,
} from "./iva-condiciones.js";

export { CONDICION_IVA_CF, CONDICION_IVA_RI } from "./iva-condiciones.js";
export {
  CONDICION_IVA_EXENTO,
  CONDICION_IVA_MONOTRIBUTO,
  CONDICIONES_IVA_RECEPTOR,
} from "./iva-condiciones.js";
export {
  cbteTipoNotaCredito,
  cbteTipoNotaDebito,
  cbteTipoPorCondicionIva,
  discriminaIva,
} from "./cbte-tipo.js";

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

function facturaBConsumidorFinal(): ComprobanteResuelto {
  return {
    cbteTipo: CbteTipo.FACTURA_B,
    docTipo: DocTipo.CONSUMIDOR_FINAL,
    docNro: 0,
    condicionIva: CONDICION_IVA_CF,
    label: "Factura B — Consumidor final",
  };
}

export function resolverComprobante(cliente: ClienteFiscal | null): ComprobanteResuelto {
  if (!cliente) {
    return facturaBConsumidorFinal();
  }

  const cuit = normalizeCuit(cliente.documento);
  const condicion = cliente.condicion_iva_receptor_id ?? CONDICION_IVA_CF;
  const cbteTipo = cbteTipoPorCondicionIva(condicion);

  if (cbteTipo === CbteTipo.FACTURA_A) {
    if (!cuit) {
      throw new AppError(
        400,
        "CLIENTE_SIN_CUIT",
        "Factura A requiere un CUIT válido en el cliente",
      );
    }
    return {
      cbteTipo: CbteTipo.FACTURA_A,
      docTipo: DocTipo.CUIT,
      docNro: Number(cuit),
      condicionIva: condicion,
      label: `Factura A — ${labelCondicionIva(condicion)}`,
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

  return facturaBConsumidorFinal();
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
  if (!requiereFacturaA(cliente.condicion_iva_receptor_id)) {
    throw new AppError(
      400,
      "CLIENTE_SIN_CONDICION_A",
      "Factura A requiere condición IVA Responsable Inscripto o Monotributo (códigos 1, 6, 13 o 16)",
    );
  }
}
