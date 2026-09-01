import { describe, expect, it } from "vitest";
import { parseInvoiceText } from "./invoice-parser.js";
import {
  hasCriticalErrors,
  validateReviewInvoice,
} from "./validation.js";
import type { NormalizedInvoice } from "./schemas.js";

const SAMPLE = `
FACTURA A
CUIT: 30-71234567-8
Razón Social: Proveedor Demo SA
Fecha de Emisión: 15/03/2026
Comprobante: 0001-00004567

ABC-001 Cable UTP Cat6 10 1500,00 15000,00
XYZ-99 Conector RJ45 5 200,50 1002,50

Importe Neto Gravado: 16002,50
IVA 21%: 3360,53
Total: 19363,03
`;

describe("parseInvoiceText", () => {
  it("extracts CUIT, tipo, PV-número, fecha and line items", () => {
    const inv = parseInvoiceText(SAMPLE);
    expect(inv.proveedor.cuit).toBe("30712345678");
    expect(inv.factura.tipo).toBe("A");
    expect(inv.factura.punto_venta).toBe("0001");
    expect(inv.factura.numero).toBe("00004567");
    expect(inv.factura.fecha).toBe("2026-03-15");
    expect(inv.items.length).toBeGreaterThanOrEqual(1);
    expect(inv.totales.total).toBeGreaterThan(0);
  });

  it("returns empty items for non-invoice text without crashing", () => {
    const inv = parseInvoiceText("hola mundo sin datos fiscales suficientes aqui");
    expect(inv.items).toEqual([]);
  });
});

describe("validateReviewInvoice", () => {
  const base = (): NormalizedInvoice => ({
    proveedor: {
      cuit: "30712345678",
      razon_social: "Demo",
      proveedor_id: "11111111-1111-1111-1111-111111111111",
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
        importe: 200,
        variant_id: "22222222-2222-2222-2222-222222222222",
        sku: "abc",
        producto_nombre: "Test",
        encontrado: true,
        requiere_revision: false,
      },
    ],
    totales: { subtotal: 200, iva: 42, total: 242 },
  });

  it("passes a complete invoice", () => {
    const issues = validateReviewInvoice(base());
    expect(hasCriticalErrors(issues)).toBe(false);
  });

  it("flags missing product as error", () => {
    const inv = base();
    inv.items[0].variant_id = null;
    inv.items[0].encontrado = false;
    const issues = validateReviewInvoice(inv);
    expect(hasCriticalErrors(issues)).toBe(true);
    expect(issues.some((i) => i.code === "PRODUCTO_SIN_MATCH")).toBe(true);
  });

  it("warns on line importe mismatch", () => {
    const inv = base();
    inv.items[0].importe = 999;
    const issues = validateReviewInvoice(inv);
    expect(issues.some((i) => i.code === "IMPORTE_LINEA" && i.level === "warning")).toBe(
      true,
    );
  });
});
