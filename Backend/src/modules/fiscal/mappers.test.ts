import { describe, expect, it } from "vitest";
import { AppError } from "../../middleware/errors.js";
import {
  formatComprobanteNumero,
  lineasToArcaItems,
  mapAlicuotaToIvaTipo,
} from "./mappers.js";
import type { LineaFiscal } from "./types.js";

describe("mapAlicuotaToIvaTipo", () => {
  it("maps known rates", () => {
    expect(mapAlicuotaToIvaTipo(21)).toBeTruthy();
    expect(mapAlicuotaToIvaTipo(10.5)).toBeTruthy();
    expect(mapAlicuotaToIvaTipo(0)).toBeTruthy();
  });

  it("throws AppError for unsupported rate", () => {
    expect(() => mapAlicuotaToIvaTipo(99)).toThrow(AppError);
  });
});

describe("lineasToArcaItems", () => {
  it("groups net amounts by alicuota", () => {
    const lineas: LineaFiscal[] = [
      { neto_linea: 100, iva_linea: 21, exento_linea: 0, alicuota_iva: 21 },
      { neto_linea: 50, iva_linea: 10.5, exento_linea: 0, alicuota_iva: 21 },
      { neto_linea: 200, iva_linea: 21, exento_linea: 0, alicuota_iva: 10.5 },
    ];
    const items = lineasToArcaItems(lineas);
    const by21 = items.find((i) => i.neto === 150);
    const by105 = items.find((i) => i.neto === 200);
    expect(by21).toBeTruthy();
    expect(by105).toBeTruthy();
  });

  it("includes exento lines", () => {
    const lineas: LineaFiscal[] = [
      { neto_linea: 0, iva_linea: 0, exento_linea: 80, alicuota_iva: 0 },
    ];
    const items = lineasToArcaItems(lineas);
    expect(items).toHaveLength(1);
    expect(items[0].exento).toBe(true);
    expect(items[0].neto).toBe(80);
  });

  it("throws when there are no billable amounts", () => {
    expect(() => lineasToArcaItems([])).toThrow(AppError);
  });
});

describe("formatComprobanteNumero", () => {
  it("formats PV and number", () => {
    const formatted = formatComprobanteNumero(1, 6, 42);
    expect(formatted).toMatch(/0001/);
    expect(formatted).toMatch(/00000042/);
  });
});
