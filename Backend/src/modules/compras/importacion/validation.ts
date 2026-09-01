import { ROUNDING_TOLERANCE, type NormalizedInvoice } from "./schemas.js";
import {
  applyComputedAmountsToInvoice,
  computeInvoiceAmounts,
  isAllowedIvaAlicuota,
} from "./invoice-math.js";

export type ValidationIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
  item_index?: number;
};

function normalizeCuitDigits(cuit: string | null | undefined): string | null {
  if (!cuit) return null;
  const digits = cuit.replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

export function validateReviewInvoice(invoice: NormalizedInvoice): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const computed = applyComputedAmountsToInvoice(invoice);
  const cuitDigits = normalizeCuitDigits(computed.proveedor.cuit);
  const razon = computed.proveedor.razon_social?.trim() ?? "";

  if (!computed.proveedor.proveedor_id) {
    if (!cuitDigits || !razon) {
      issues.push({
        level: "error",
        code: "PROVEEDOR_REQUIRED",
        message:
          "Proveedor no identificado: ingresá CUIT (11 dígitos) y razón social (se creará al confirmar)",
      });
    } else {
      issues.push({
        level: "warning",
        code: "PROVEEDOR_SE_CREARA",
        message: "El proveedor no existe: se creará al confirmar la orden",
      });
    }
  }

  if (!cuitDigits && !computed.proveedor.proveedor_id) {
    issues.push({
      level: "error",
      code: "CUIT_INVALIDO",
      message: "CUIT de proveedor inválido",
    });
  }

  if (!computed.factura.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(computed.factura.fecha)) {
    issues.push({
      level: "error",
      code: "FECHA_INVALIDA",
      message: "Fecha de factura inválida",
    });
  }
  if (!computed.factura.tipo || !/^[ABC]$/i.test(computed.factura.tipo)) {
    issues.push({
      level: "error",
      code: "TIPO_INVALIDO",
      message: "Tipo de comprobante inválido (A/B/C)",
    });
  }
  if (!computed.factura.punto_venta || !computed.factura.numero) {
    issues.push({
      level: "error",
      code: "NUMERO_INVALIDO",
      message: "Punto de venta y número de factura son obligatorios",
    });
  }
  if (computed.items.length === 0) {
    issues.push({
      level: "error",
      code: "SIN_ITEMS",
      message: "La factura no tiene líneas de producto",
    });
  }

  const { lines, totals } = computeInvoiceAmounts(
    computed.items,
    computed.totales.descuento_total,
  );
  const sumNetosAntes = lines.reduce((s, l) => s + l.neto_antes_dto_global, 0);
  if ((computed.totales.descuento_total ?? 0) > sumNetosAntes + ROUNDING_TOLERANCE) {
    issues.push({
      level: "error",
      code: "DESCUENTO_TOTAL_INVALIDO",
      message: "El descuento total no puede superar el neto de las líneas",
    });
  }

  computed.items.forEach((item, idx) => {
    const original = invoice.items[idx];
    if (!item.variant_id) {
      issues.push({
        level: "error",
        code: "PRODUCTO_SIN_MATCH",
        message: `Línea ${idx + 1}: producto no identificado (vincular SKU)`,
        item_index: idx,
      });
    }
    if (!item.codigo_proveedor?.trim()) {
      issues.push({
        level: "error",
        code: "CODIGO_PROVEEDOR_REQUIRED",
        message: `Línea ${idx + 1}: código de proveedor obligatorio`,
        item_index: idx,
      });
    }
    if (!item.sku?.trim() && item.variant_id) {
      issues.push({
        level: "warning",
        code: "SKU_MISSING",
        message: `Línea ${idx + 1}: falta SKU interno`,
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
    const pct = item.descuento_porcentaje ?? 0;
    if (pct < 0 || pct > 100) {
      issues.push({
        level: "error",
        code: "DESCUENTO_PCT_INVALIDO",
        message: `Línea ${idx + 1}: descuento % debe estar entre 0 y 100`,
        item_index: idx,
      });
    }
    if (!isAllowedIvaAlicuota(item.alicuota_iva ?? 21)) {
      issues.push({
        level: "error",
        code: "IVA_INVALIDO",
        message: `Línea ${idx + 1}: alícuota IVA inválida`,
        item_index: idx,
      });
    }

    const line = lines[idx];
    if (
      line &&
      original &&
      Math.abs(line.importe - original.importe) > ROUNDING_TOLERANCE
    ) {
      issues.push({
        level: "warning",
        code: "IMPORTE_LINEA",
        message: `Línea ${idx + 1}: importe no cuadra (esperado ~${line.importe.toFixed(2)})`,
        item_index: idx,
      });
    }
  });

  const sub = invoice.totales.subtotal;
  const iva = invoice.totales.iva ?? 0;
  const tot = invoice.totales.total;
  if (sub != null && Math.abs(totals.subtotal - sub) > ROUNDING_TOLERANCE) {
    issues.push({
      level: "warning",
      code: "SUBTOTAL_MISMATCH",
      message: `Subtotal recalculado (${totals.subtotal.toFixed(2)}) ≠ declarado (${sub.toFixed(2)})`,
    });
  }
  if (tot != null && Math.abs(totals.total - tot) > ROUNDING_TOLERANCE) {
    issues.push({
      level: "warning",
      code: "TOTAL_MISMATCH",
      message: `Total recalculado (${totals.total.toFixed(2)}) ≠ declarado (${tot.toFixed(2)})`,
    });
  }
  if (sub != null && tot != null && Math.abs(sub + iva - tot) > ROUNDING_TOLERANCE) {
    issues.push({
      level: "warning",
      code: "TOTAL_ARITMETICA",
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

/** ¿Se puede ejecutar aunque proveedor_id sea null (se creará)? */
export function canExecuteWithoutProveedorId(invoice: NormalizedInvoice): boolean {
  const cuit = normalizeCuitDigits(invoice.proveedor.cuit);
  const razon = invoice.proveedor.razon_social?.trim();
  return Boolean(invoice.proveedor.proveedor_id || (cuit && razon));
}
