import { describe, expect, it } from "vitest";
import {
  applyComputedAmountsToInvoice,
  computeInvoiceAmounts,
  roundCents,
} from "./invoice-math.js";
import {
  hasCriticalErrors,
  validateReviewInvoice,
} from "./validation.js";
import type { NormalizedInvoice } from "./schemas.js";

describe("computeInvoiceAmounts", () => {
  it("applies line discount as percentage", () => {
    const { lines, totals } = computeInvoiceAmounts(
      [{ cantidad: 10, precio_unitario: 100, descuento_porcentaje: 10, alicuota_iva: 21 }],
      0,
    );
    expect(lines[0]!.bruto).toBe(1000);
    expect(lines[0]!.descuento_monto).toBe(100);
    expect(lines[0]!.neto_linea).toBe(900);
    expect(lines[0]!.iva_linea).toBe(189);
    expect(totals.subtotal).toBe(900);
    expect(totals.iva).toBe(189);
    expect(totals.total).toBe(1089);
  });

  it("prorates invoice-level discount before IVA and assigns residue to last line", () => {
    const { lines, totals } = computeInvoiceAmounts(
      [
        { cantidad: 1, precio_unitario: 100, descuento_porcentaje: 0, alicuota_iva: 21 },
        { cantidad: 1, precio_unitario: 300, descuento_porcentaje: 0, alicuota_iva: 21 },
      ],
      10,
    );
    expect(totals.descuento_total).toBe(10);
    expect(roundCents(lines[0]!.descuento_total_prorrateado + lines[1]!.descuento_total_prorrateado)).toBe(
      10,
    );
    expect(totals.subtotal).toBe(390);
    expect(totals.iva).toBe(roundCents(390 * 0.21));
    expect(totals.total).toBe(roundCents(390 + totals.iva));
  });

  it("supports mixed IVA rates and exento", () => {
    const { totals } = computeInvoiceAmounts(
      [
        { cantidad: 1, precio_unitario: 100, descuento_porcentaje: 0, alicuota_iva: 21 },
        { cantidad: 1, precio_unitario: 100, descuento_porcentaje: 0, alicuota_iva: 10.5 },
        { cantidad: 1, precio_unitario: 50, descuento_porcentaje: 0, alicuota_iva: 0 },
      ],
      0,
    );
    expect(totals.exento).toBe(50);
    expect(totals.by_alicuota).toHaveLength(3);
    expect(totals.iva).toBe(roundCents(21 + 10.5));
    expect(totals.subtotal).toBe(250);
    expect(totals.total).toBe(roundCents(250 + totals.iva));
  });

  it("caps total discount at line net sum", () => {
    const { totals } = computeInvoiceAmounts(
      [{ cantidad: 1, precio_unitario: 100, descuento_porcentaje: 0, alicuota_iva: 21 }],
      999,
    );
    expect(totals.descuento_total).toBe(100);
    expect(totals.subtotal).toBe(0);
    expect(totals.total).toBe(0);
  });
});

describe("applyComputedAmountsToInvoice + validation", () => {
  const base = (): NormalizedInvoice => ({
    proveedor: {
      cuit: "30712345678",
      razon_social: "Demo",
      proveedor_id: "11111111-1111-1111-1111-111111111111",
      se_creara: false,
    },
    factura: {
      tipo: "A",
      punto_venta: "0001",
      numero: "00000001",
      fecha: "2026-03-15",
    },
    items: [
      {
        codigo_proveedor: "ABC",
        descripcion: "Test",
        cantidad: 2,
        precio_unitario: 100,
        descuento: 0,
        descuento_porcentaje: 0,
        alicuota_iva: 21,
        importe: 200,
        neto_linea: null,
        iva_linea: null,
        total_linea: null,
        variant_id: "22222222-2222-2222-2222-222222222222",
        sku: "abc",
        producto_nombre: "Test",
        encontrado: true,
        requiere_revision: false,
        confirmar_cambio_mapeo: false,
      },
    ],
    totales: { subtotal: 200, iva: 42, total: 242, descuento_total: 0, exento: 0 },
  });

  it("allows execute when supplier will be created", () => {
    const inv = base();
    inv.proveedor.proveedor_id = null;
    inv.proveedor.se_creara = true;
    const issues = validateReviewInvoice(inv);
    expect(hasCriticalErrors(issues)).toBe(false);
  });

  it("requires codigo proveedor", () => {
    const inv = base();
    inv.items[0]!.codigo_proveedor = null;
    const issues = validateReviewInvoice(inv);
    expect(issues.some((i) => i.code === "CODIGO_PROVEEDOR_REQUIRED")).toBe(true);
  });

  it("recalculates legacy drafts without porcentaje", () => {
    const inv = applyComputedAmountsToInvoice({
      ...base(),
      items: [
        {
          ...base().items[0]!,
          descuento_porcentaje: undefined as unknown as number,
          descuento: 20,
          importe: 180,
        },
      ],
      totales: { subtotal: null, iva: null, total: null, descuento_total: 0 },
    });
    expect(inv.items[0]!.importe).toBe(180);
    expect(inv.totales.subtotal).toBe(180);
    expect(inv.totales.iva).toBe(37.8);
  });
});
