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

  it("parses OCR-style table rows with numeric supplier codes", () => {
    const OCR = `
FACTURA A 00003 - 00040899
Fecna: 26/08/26
EXIMETAL S.A.
CUIT: 30-70841130-0

100012  Cano estructural 20x20  120  1.250,00  150.000,00
100034  Perfil U 80x40  85  2.100,50  178.542,50

Importe Neto Gravado: 853.740,00
IVA 21%: 179.285,40
Total: 1.033.025,40
`;
    const inv = parseInvoiceText(OCR);
    expect(inv.factura.tipo).toBe("A");
    expect(inv.factura.punto_venta).toBe("0003");
    expect(inv.factura.numero).toBe("00040899");
    expect(inv.proveedor.razon_social).toContain("EXIMETAL");
    expect(inv.items.length).toBeGreaterThanOrEqual(2);
    expect(inv.totales.subtotal).toBeCloseTo(853740, 0);
  });

  it("parses columnar OCR layout (COD/CANT/DETALLE/UNITARIO/TOTAL stacked)", () => {
    const COLUMNAR_OCR = `
FACTURA
A
EXIMETAL S.A.
Senor/es:
CLIENTE DEMO
COD
EC67
E107
EC61
EC62
CANT
6,00
2,00
1,00
1,00
KG
L
KE
KG
DETALL E
SOLD. SN 60%D.0 7MM CT 250 GR
SOLD. SN 60% D0 7 MM CT 100G ******
SOLD. SN 60% 0.1 MM CT 250 GR
SOLD. SN 60% D.2 MM CT 250 GR.
CODIGO 000001
C.U. l.T. N°: 30519144138
UNITARIO %D
82620,00
96390.00
82620.00
82620,00
c.
TOTAL
495.720,00
192.780,00
82.620,00
82.620,00
00003 - 00040899
FECHA: 26/08/26
SUbtotal
853.740,00
179.285,40
TOTAL $
1.033.025,40
`;
    const inv = parseInvoiceText(COLUMNAR_OCR);
    expect(inv.items).toHaveLength(4);
    expect(inv.items.map((i) => i.codigo_proveedor)).toEqual(["EC67", "E107", "EC61", "EC62"]);
    expect(inv.items[0]!.cantidad).toBeCloseTo(6, 2);
    expect(inv.items[0]!.precio_unitario).toBeCloseTo(82620, 0);
    expect(inv.items[0]!.importe).toBeCloseTo(495720, 0);
    expect(inv.items[1]!.importe).toBeCloseTo(192780, 0);
    expect(inv.proveedor.cuit).toBe("30519144138");
    expect(inv.factura.punto_venta).toBe("0003");
    expect(inv.factura.numero).toBe("00040899");
    expect(inv.totales.subtotal).toBeCloseTo(853740, 0);
    expect(inv.totales.total).toBeCloseTo(1033025.4, 0);
  });
});

describe("validateReviewInvoice", () => {
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
        neto_linea: 200,
        iva_linea: 42,
        total_linea: 242,
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

  it("passes a complete invoice", () => {
    const issues = validateReviewInvoice(base());
    expect(hasCriticalErrors(issues)).toBe(false);
  });

  it("flags missing product as error", () => {
    const inv = base();
    inv.items[0]!.variant_id = null;
    inv.items[0]!.encontrado = false;
    const issues = validateReviewInvoice(inv);
    expect(hasCriticalErrors(issues)).toBe(true);
    expect(issues.some((i) => i.code === "PRODUCTO_SIN_MATCH")).toBe(true);
  });

  it("warns on line importe mismatch", () => {
    const inv = base();
    inv.items[0]!.importe = 999;
    const issues = validateReviewInvoice(inv);
    expect(issues.some((i) => i.code === "IMPORTE_LINEA" && i.level === "warning")).toBe(
      true,
    );
  });
});
