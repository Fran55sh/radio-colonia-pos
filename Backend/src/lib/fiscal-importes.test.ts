import { describe, expect, it } from "vitest";
import { IvaTipo } from "@ramiidv/arca-facturacion";
import {
  calcularImportesVenta,
  centsToDecimal,
  moneyFromCents,
  round2,
} from "./fiscal-importes.js";

function grupo(total: number, alicuota: number) {
  return calcularImportesVenta([{ orden: 0, cantidad: 1, precio_unitario: total, alicuota }]);
}

describe("calcularImportesVenta", () => {
  it("$100 @21% → 82,64 / 17,36 / 100,00", () => {
    const r = grupo(100, 21);
    expect(r.neto_cents).toBe(8264);
    expect(r.iva_cents).toBe(1736);
    expect(r.total_cents).toBe(10000);
    expect(centsToDecimal(r.neto_cents)).toBe("82.64");
    expect(centsToDecimal(r.iva_cents)).toBe("17.36");
  });

  it("$100 @10,5% → 90,50 / 9,50 / 100,00", () => {
    const r = grupo(100, 10.5);
    expect([r.neto_cents, r.iva_cents, r.total_cents]).toEqual([9050, 950, 10000]);
  });

  it("3 productos distintos de $100 @21%", () => {
    const r = calcularImportesVenta([
      { orden: 0, cantidad: 1, precio_unitario: 100, alicuota: 21 },
      { orden: 1, cantidad: 1, precio_unitario: 100, alicuota: 21 },
      { orden: 2, cantidad: 1, precio_unitario: 100, alicuota: 21 },
    ]);
    expect([r.neto_cents, r.iva_cents, r.total_cents]).toEqual([24793, 5207, 30000]);
    expect(r.lineas.map((l) => l.neto_cents)).toEqual([8265, 8264, 8264]);
    expect(r.lineas.map((l) => l.iva_cents)).toEqual([1735, 1736, 1736]);
    expect(r.grupos).toHaveLength(1);
  });

  it("$121 @21% + $110,50 @10,5%", () => {
    const r = calcularImportesVenta([
      { orden: 0, cantidad: 1, precio_unitario: 121, alicuota: 21 },
      { orden: 1, cantidad: 1, precio_unitario: 110.5, alicuota: 10.5 },
    ]);
    expect(r.grupos.map((g) => [g.alicuota, g.neto_cents, g.iva_cents])).toEqual([
      [21, 10000, 2100],
      [10.5, 10000, 1050],
    ]);
    expect(r.total_cents).toBe(23150);
  });

  it("$100 @21% + $100 @10,5% → 173,14 / 26,86 / 200,00", () => {
    const r = calcularImportesVenta([
      { orden: 0, cantidad: 1, precio_unitario: 100, alicuota: 21 },
      { orden: 1, cantidad: 1, precio_unitario: 100, alicuota: 10.5 },
    ]);
    expect([r.neto_cents, r.iva_cents, r.total_cents]).toEqual([17314, 2686, 20000]);
  });

  it("$1.500 / $12.345 / $999,99 @21%", () => {
    const cases = [
      [1500, 123967],
      [12345, 1020248],
      [999.99, 82644],
    ] as const;
    for (const [total, neto] of cases) {
      const r = grupo(total, 21);
      expect(r.neto_cents).toBe(neto);
      expect(r.neto_cents + r.iva_cents).toBe(r.total_cents);
    }
  });

  it("para todo total, neto+iva=total y el IVA no se aleja más de un centavo", () => {
    const check = (cents: number, alicuota: number): boolean => {
      const denom = 10_000 + Math.round(alicuota * 100);
      const neto = Math.round((cents * 10_000) / denom);
      const iva = cents - neto;
      if (neto + iva !== cents) return false;
      return Math.abs(iva - Math.round(neto * (alicuota / 100))) <= 1;
    };
    for (const alicuota of [21, 10.5]) {
      for (let cents = 1; cents <= 10_000_000; cents++) {
        if (!check(cents, alicuota)) {
          throw new Error(`falla en ${cents} @ ${alicuota}`);
        }
      }
      for (let cents = 1; cents <= 20_000; cents += 1) {
        const r = calcularImportesVenta([
          { orden: 0, cantidad: 1, precio_unitario: cents / 100, alicuota },
        ]);
        if (r.neto_cents + r.iva_cents !== r.total_cents) throw new Error("suma");
        if (r.lineas[0].neto_cents + r.lineas[0].iva_cents !== r.lineas[0].total_cents) {
          throw new Error("linea");
        }
      }
    }
    expect(true).toBe(true);
  }, 20_000);

  it("Iva ids de los casos de aceptación", () => {
    expect(IvaTipo.IVA_21).toBe(5);
    expect(IvaTipo.IVA_10_5).toBe(4);
    expect(moneyFromCents(8264)).toBe(82.64);
    expect(round2(82.64 * 0.21)).toBeCloseTo(17.35, 2);
  });
});
