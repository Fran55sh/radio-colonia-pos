import { describe, expect, it } from "vitest";
import { CbteTipo, IvaTipo } from "@ramiidv/arca-facturacion";
import {
  cbteTipoNotaCredito,
  cbteTipoNotaDebito,
  cbteTipoPorCondicionIva,
  discriminaIva,
} from "./cbte-tipo.js";
import {
  CONDICION_IVA_CF,
  CONDICION_IVA_EXENTO,
  CONDICION_IVA_IVA_NO_ALCANZADO,
  CONDICION_IVA_MONOTRIBUTO,
  CONDICION_IVA_MONOTRIBUTO_SOCIAL,
  CONDICION_IVA_MONOTRIBUTO_TIP,
  CONDICION_IVA_NO_CATEGORIZADO,
  CONDICION_IVA_NO_RESPONSABLE,
  CONDICION_IVA_RI,
} from "./iva-condiciones.js";
import { lineasToArcaItems } from "./mappers.js";

describe("mapeo condición IVA → tipo de comprobante (RG 5003/2021)", () => {
  const casosA: Array<[string, number]> = [
    ["Responsable Inscripto", CONDICION_IVA_RI],
    ["Monotributo", CONDICION_IVA_MONOTRIBUTO],
    ["Monotributo Social", CONDICION_IVA_MONOTRIBUTO_SOCIAL],
    ["Monotributista Trabajador Independiente Promovido", CONDICION_IVA_MONOTRIBUTO_TIP],
  ];

  const casosB: Array<[string, number]> = [
    ["Consumidor Final", CONDICION_IVA_CF],
    ["Exento", CONDICION_IVA_EXENTO],
    ["No Responsable", CONDICION_IVA_NO_RESPONSABLE],
    ["Sujeto no categorizado", CONDICION_IVA_NO_CATEGORIZADO],
    ["IVA no alcanzado", CONDICION_IVA_IVA_NO_ALCANZADO],
  ];

  it.each(casosA)("%s (%i) → Factura A (tipo 1)", (_label, condicion) => {
    expect(cbteTipoPorCondicionIva(condicion)).toBe(CbteTipo.FACTURA_A);
    expect(cbteTipoPorCondicionIva(condicion)).toBe(1);
  });

  it.each(casosB)("%s (%i) → Factura B (tipo 6)", (_label, condicion) => {
    expect(cbteTipoPorCondicionIva(condicion)).toBe(CbteTipo.FACTURA_B);
    expect(cbteTipoPorCondicionIva(condicion)).toBe(6);
  });

  it("condición desconocida no recibe Factura A", () => {
    expect(cbteTipoPorCondicionIva(99)).toBe(CbteTipo.FACTURA_B);
  });
});

describe("notas de crédito/débito asociadas (misma letra)", () => {
  it("Factura A → NC A (3) y ND A (2)", () => {
    expect(cbteTipoNotaCredito(CbteTipo.FACTURA_A)).toBe(CbteTipo.NOTA_CREDITO_A);
    expect(cbteTipoNotaCredito(CbteTipo.FACTURA_A)).toBe(3);
    expect(cbteTipoNotaDebito(CbteTipo.FACTURA_A)).toBe(CbteTipo.NOTA_DEBITO_A);
    expect(cbteTipoNotaDebito(CbteTipo.FACTURA_A)).toBe(2);
  });

  it("Factura B → NC B (8) y ND B (7)", () => {
    expect(cbteTipoNotaCredito(CbteTipo.FACTURA_B)).toBe(CbteTipo.NOTA_CREDITO_B);
    expect(cbteTipoNotaCredito(CbteTipo.FACTURA_B)).toBe(8);
    expect(cbteTipoNotaDebito(CbteTipo.FACTURA_B)).toBe(CbteTipo.NOTA_DEBITO_B);
    expect(cbteTipoNotaDebito(CbteTipo.FACTURA_B)).toBe(7);
  });

  it("Monotributo (letra A) arrastra NC/ND A", () => {
    const original = cbteTipoPorCondicionIva(CONDICION_IVA_MONOTRIBUTO);
    expect(original).toBe(CbteTipo.FACTURA_A);
    expect(cbteTipoNotaCredito(original)).toBe(CbteTipo.NOTA_CREDITO_A);
    expect(cbteTipoNotaDebito(original)).toBe(CbteTipo.NOTA_DEBITO_A);
  });

  it("Consumidor final (letra B) arrastra NC/ND B", () => {
    const original = cbteTipoPorCondicionIva(CONDICION_IVA_CF);
    expect(original).toBe(CbteTipo.FACTURA_B);
    expect(cbteTipoNotaCredito(original)).toBe(CbteTipo.NOTA_CREDITO_B);
    expect(cbteTipoNotaDebito(original)).toBe(CbteTipo.NOTA_DEBITO_B);
  });
});

describe("IVA discriminado en comprobantes A", () => {
  it("Factura A / NC A / ND A discriminan IVA; tipo C no", () => {
    expect(discriminaIva(CbteTipo.FACTURA_A)).toBe(true);
    expect(discriminaIva(CbteTipo.NOTA_CREDITO_A)).toBe(true);
    expect(discriminaIva(CbteTipo.NOTA_DEBITO_A)).toBe(true);
    expect(discriminaIva(CbteTipo.FACTURA_B)).toBe(true);
    expect(discriminaIva(CbteTipo.FACTURA_C)).toBe(false);
  });

  it("ítems de Factura A envían neto + alícuota (ImpNeto e ImpIVA)", () => {
    const items = lineasToArcaItems([
      { neto_linea: 100, iva_linea: 21, exento_linea: 0, alicuota_iva: 21 },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.neto).toBe(100);
    expect(items[0]?.iva).toBe(IvaTipo.IVA_21);
    expect(items[0]?.exento).toBeFalsy();
    expect(discriminaIva(CbteTipo.FACTURA_A)).toBe(true);
  });
});
