import { ROUNDING_TOLERANCE, type NormalizedInvoice } from "./schemas.js";

export type ValidationIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
  item_index?: number;
};

export function validateReviewInvoice(invoice: NormalizedInvoice): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!invoice.proveedor.proveedor_id) {
    issues.push({
      level: "error",
      code: "PROVEEDOR_REQUIRED",
      message: "Proveedor no identificado",
    });
  }
  if (!invoice.factura.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(invoice.factura.fecha)) {
    issues.push({
      level: "error",
      code: "FECHA_INVALIDA",
      message: "Fecha de factura inválida",
    });
  }
  if (!invoice.factura.tipo || !/^[ABC]$/i.test(invoice.factura.tipo)) {
    issues.push({
      level: "error",
      code: "TIPO_INVALIDO",
      message: "Tipo de comprobante inválido (A/B/C)",
    });
  }
  if (!invoice.factura.punto_venta || !invoice.factura.numero) {
    issues.push({
      level: "error",
      code: "NUMERO_INVALIDO",
      message: "Punto de venta y número de factura son obligatorios",
    });
  }
  if (invoice.items.length === 0) {
    issues.push({
      level: "error",
      code: "SIN_ITEMS",
      message: "La factura no tiene líneas de producto",
    });
  }

  let sumImportes = 0;
  invoice.items.forEach((item, idx) => {
    if (!item.variant_id) {
      issues.push({
        level: "error",
        code: "PRODUCTO_SIN_MATCH",
        message: `Línea ${idx + 1}: producto no identificado`,
        item_index: idx,
      });
    }
    if (!(item.cantidad > 0)) {
      issues.push({
        level: "error",
        code: "CANTIDAD_INVALIDA",
        message: `Línea ${idx + 1}: cantidad debe ser > 0`,
        item_index: idx,
      });
    }
    if (item.precio_unitario < 0) {
      issues.push({
        level: "error",
        code: "PRECIO_INVALIDO",
        message: `Línea ${idx + 1}: precio inválido`,
        item_index: idx,
      });
    }
    const expected = item.cantidad * item.precio_unitario - (item.descuento || 0);
    if (Math.abs(expected - item.importe) > ROUNDING_TOLERANCE) {
      issues.push({
        level: "warning",
        code: "IMPORTE_LINEA",
        message: `Línea ${idx + 1}: importe no cuadra (esperado ~${expected.toFixed(2)})`,
        item_index: idx,
      });
    }
    sumImportes += item.importe;
  });

  const sub = invoice.totales.subtotal;
  const iva = invoice.totales.iva ?? 0;
  const tot = invoice.totales.total;
  if (sub != null && Math.abs(sumImportes - sub) > ROUNDING_TOLERANCE * invoice.items.length) {
    issues.push({
      level: "warning",
      code: "SUBTOTAL_MISMATCH",
      message: `Suma de líneas (${sumImportes.toFixed(2)}) ≠ subtotal (${sub.toFixed(2)})`,
    });
  }
  if (sub != null && tot != null && Math.abs(sub + iva - tot) > ROUNDING_TOLERANCE) {
    issues.push({
      level: "warning",
      code: "TOTAL_MISMATCH",
      message: `Subtotal + IVA ≠ total`,
    });
  }

  return issues;
}

export function hasCriticalErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}

export function computeMatchStats(invoice: NormalizedInvoice) {
  const total = invoice.items.length;
  const matched = invoice.items.filter((i) => i.encontrado && i.variant_id).length;
  return {
    total_items: total,
    matched_items: matched,
    pending_items: total - matched,
  };
}
