import { describe, expect, it } from "vitest";
import { CbteTipo, DocTipo } from "@ramiidv/arca-facturacion";
import { AppError } from "../../middleware/errors.js";
import {
  CONDICION_IVA_CF,
  CONDICION_IVA_EXENTO,
  CONDICION_IVA_MONOTRIBUTO,
  CONDICION_IVA_MONOTRIBUTO_SOCIAL,
  CONDICION_IVA_MONOTRIBUTO_TIP,
  CONDICION_IVA_NO_CATEGORIZADO,
  CONDICION_IVA_RI,
} from "./iva-condiciones.js";
import { resolverComprobante, validarClienteParaFacturaA } from "./resolver.js";
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

  it("CUIT + RI → Factura A con DocTipo 80 y CondicionIVAReceptorId 1", () => {
    const r = resolverComprobante(
      cliente({
        documento: "20-12345678-6",
        documento_tipo_afip: "CUIT",
        condicion_iva_receptor_id: CONDICION_IVA_RI,
      }),
    );
    expect(r.cbteTipo).toBe(CbteTipo.FACTURA_A);
    expect(r.docTipo).toBe(DocTipo.CUIT);
    expect(r.docTipo).toBe(80);
    expect(r.docNro).toBe(20123456786);
    expect(r.condicionIva).toBe(CONDICION_IVA_RI);
  });

  it("CUIT + Monotributo (6) → Factura A con DocTipo 80 y CondicionIVAReceptorId 6", () => {
    const r = resolverComprobante(
      cliente({
        documento: "20123456786",
        documento_tipo_afip: "CUIT",
        condicion_iva_receptor_id: CONDICION_IVA_MONOTRIBUTO,
      }),
    );
    expect(r.cbteTipo).toBe(CbteTipo.FACTURA_A);
    expect(r.docTipo).toBe(80);
    expect(r.docNro).toBe(20123456786);
    expect(r.condicionIva).toBe(CONDICION_IVA_MONOTRIBUTO);
  });

  it("CUIT + Monotributo Social (13) → Factura A", () => {
    const r = resolverComprobante(
      cliente({
        documento: "20123456786",
        documento_tipo_afip: "CUIT",
        condicion_iva_receptor_id: CONDICION_IVA_MONOTRIBUTO_SOCIAL,
      }),
    );
    expect(r.cbteTipo).toBe(CbteTipo.FACTURA_A);
    expect(r.docTipo).toBe(DocTipo.CUIT);
    expect(r.condicionIva).toBe(CONDICION_IVA_MONOTRIBUTO_SOCIAL);
  });

  it("CUIT + Monotributista TIP (16) → Factura A", () => {
    const r = resolverComprobante(
      cliente({
        documento: "20123456786",
        documento_tipo_afip: "CUIT",
        condicion_iva_receptor_id: CONDICION_IVA_MONOTRIBUTO_TIP,
      }),
    );
    expect(r.cbteTipo).toBe(CbteTipo.FACTURA_A);
    expect(r.condicionIva).toBe(CONDICION_IVA_MONOTRIBUTO_TIP);
  });

  it("CUIT + Exento → Factura B con DocTipo 80 y CondicionIVAReceptorId 4", () => {
    const r = resolverComprobante(
      cliente({
        documento: "20123456786",
        documento_tipo_afip: "CUIT",
        condicion_iva_receptor_id: CONDICION_IVA_EXENTO,
      }),
    );
    expect(r.cbteTipo).toBe(CbteTipo.FACTURA_B);
    expect(r.docTipo).toBe(80);
    expect(r.condicionIva).toBe(CONDICION_IVA_EXENTO);
  });

  it("CUIT + No categorizado → Factura B", () => {
    const r = resolverComprobante(
      cliente({
        documento: "20123456786",
        documento_tipo_afip: "CUIT",
        condicion_iva_receptor_id: CONDICION_IVA_NO_CATEGORIZADO,
      }),
    );
    expect(r.cbteTipo).toBe(CbteTipo.FACTURA_B);
    expect(r.condicionIva).toBe(CONDICION_IVA_NO_CATEGORIZADO);
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

  it("un emisor RI no resuelve Factura C", () => {
    const casos: Array<Partial<ClienteFiscal> | null> = [
      null,
      { condicion_iva_receptor_id: CONDICION_IVA_CF },
      { condicion_iva_receptor_id: CONDICION_IVA_EXENTO, documento: "20123456786" },
      { condicion_iva_receptor_id: CONDICION_IVA_RI, documento: "20123456786" },
      { condicion_iva_receptor_id: CONDICION_IVA_MONOTRIBUTO, documento: "20123456786" },
      { condicion_iva_receptor_id: CONDICION_IVA_NO_CATEGORIZADO, documento: "20123456786" },
      { condicion_iva_receptor_id: CONDICION_IVA_MONOTRIBUTO_SOCIAL, documento: "20123456786" },
      { condicion_iva_receptor_id: CONDICION_IVA_MONOTRIBUTO_TIP, documento: "20123456786" },
    ];
    for (const parcial of casos) {
      const resuelto = resolverComprobante(parcial ? cliente(parcial) : null);
      expect(resuelto.cbteTipo).not.toBe(CbteTipo.FACTURA_C);
      expect([CbteTipo.FACTURA_A, CbteTipo.FACTURA_B]).toContain(resuelto.cbteTipo);
    }
  });

  it("Monotributo sin CUIT → error CLIENTE_SIN_CUIT", () => {
    const act = () =>
      resolverComprobante(
        cliente({
          documento: "30111222",
          documento_tipo_afip: "DNI",
          condicion_iva_receptor_id: CONDICION_IVA_MONOTRIBUTO,
        }),
      );
    expect(act).toThrow(AppError);
    expect(act).toThrow(/CUIT/);
  });
});

describe("validarClienteParaFacturaA", () => {
  it("acepta Monotributo con CUIT", () => {
    expect(() =>
      validarClienteParaFacturaA(
        cliente({
          documento: "20123456786",
          condicion_iva_receptor_id: CONDICION_IVA_MONOTRIBUTO,
        }),
      ),
    ).not.toThrow();
  });

  it("rechaza Consumidor Final", () => {
    expect(() =>
      validarClienteParaFacturaA(
        cliente({
          documento: "20123456786",
          condicion_iva_receptor_id: CONDICION_IVA_CF,
        }),
      ),
    ).toThrow(AppError);
  });
});
