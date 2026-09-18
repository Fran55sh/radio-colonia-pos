import { describe, expect, it } from "vitest";
import { CbteTipo, DocTipo } from "@ramiidv/arca-facturacion";
import { AppError } from "../../middleware/errors.js";
import {
  CONDICION_IVA_CF,
  CONDICION_IVA_MONOTRIBUTO,
  CONDICION_IVA_RI,
} from "./iva-condiciones.js";
import { resolverComprobante } from "./resolver.js";
import type { ClienteFiscal } from "./types.js";

function cliente(partial: Partial<ClienteFiscal>): ClienteFiscal {
  return {
    id: 1,
    nombre: "Test",
    documento: null,
    documento_tipo_afip: null,
    condicion_iva_receptor_id: null,
    razon_social: null,
    ...partial,
  };
}

describe("resolverComprobante", () => {
  it("sin cliente → Factura B consumidor final", () => {
    const r = resolverComprobante(null);
    expect(r.cbteTipo).toBe(CbteTipo.FACTURA_B);
    expect(r.docTipo).toBe(DocTipo.CONSUMIDOR_FINAL);
    expect(r.docNro).toBe(0);
    expect(r.condicionIva).toBe(CONDICION_IVA_CF);
  });

  it("CUIT + RI → Factura A", () => {
    const r = resolverComprobante(
      cliente({
        documento: "20-12345678-6",
        documento_tipo_afip: "CUIT",
        condicion_iva_receptor_id: CONDICION_IVA_RI,
      }),
    );
    expect(r.cbteTipo).toBe(CbteTipo.FACTURA_A);
    expect(r.docTipo).toBe(DocTipo.CUIT);
    expect(r.docNro).toBe(20123456786);
    expect(r.condicionIva).toBe(CONDICION_IVA_RI);
  });

  it("CUIT + otra condición → Factura B", () => {
    const r = resolverComprobante(
      cliente({
        documento: "20123456786",
        documento_tipo_afip: "CUIT",
        condicion_iva_receptor_id: CONDICION_IVA_MONOTRIBUTO,
      }),
    );
    expect(r.cbteTipo).toBe(CbteTipo.FACTURA_B);
    expect(r.docTipo).toBe(DocTipo.CUIT);
    expect(r.docNro).toBe(20123456786);
  });

  it("DNI → Factura B consumidor final", () => {
    const r = resolverComprobante(
      cliente({
        documento: "30111222",
        documento_tipo_afip: "DNI",
        condicion_iva_receptor_id: CONDICION_IVA_CF,
      }),
    );
    expect(r.cbteTipo).toBe(CbteTipo.FACTURA_B);
    expect(r.docTipo).toBe(DocTipo.CONSUMIDOR_FINAL);
    expect(r.docNro).toBe(0);
  });
});
