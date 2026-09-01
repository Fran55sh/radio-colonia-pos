/** Alícuotas IVA permitidas en facturas de compra. */
export const ALLOWED_IVA_ALICUOTAS = [0, 10.5, 21, 27] as const;
export type AllowedIvaAlicuota = (typeof ALLOWED_IVA_ALICUOTAS)[number];

export function roundCents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function isAllowedIvaAlicuota(value: number): value is AllowedIvaAlicuota {
  return ALLOWED_IVA_ALICUOTAS.some((a) => Math.abs(a - value) < 0.001);
}

export type InvoiceLineInput = {
  cantidad: number;
  precio_unitario: number;
  /** Porcentaje 0–100 */
  descuento_porcentaje?: number | null;
  /** Compat: monto fijo histórico (si no hay %). */
  descuento?: number | null;
  alicuota_iva?: number | null;
};

export type ComputedInvoiceLine = {
  bruto: number;
  descuento_porcentaje: number;
  descuento_monto: number;
  neto_antes_dto_global: number;
  descuento_total_prorrateado: number;
  neto_linea: number;
  alicuota_iva: number;
  iva_linea: number;
  total_linea: number;
  /** Alias histórico: monto de descuento de línea (sin dto global). */
  descuento: number;
  importe: number;
};

export type ComputedInvoiceTotals = {
  subtotal_bruto: number;
  descuento_lineas: number;
  descuento_total: number;
  subtotal: number;
  iva: number;
  exento: number;
  total: number;
  by_alicuota: Array<{
    alicuota: number;
    neto_gravado: number;
    iva: number;
    exento: number;
    total: number;
  }>;
};

/**
 * Calcula una línea: bruto → dto % → neto parcial.
 * El descuento total de factura se aplica después (prorrateo).
 */
export function computeLineBeforeGlobalDiscount(input: InvoiceLineInput): {
  bruto: number;
  descuento_porcentaje: number;
  descuento_monto: number;
  neto_antes_dto_global: number;
  alicuota_iva: number;
} {
  const cantidad = Number(input.cantidad) || 0;
  const precio = Number(input.precio_unitario) || 0;
  const bruto = roundCents(cantidad * precio);

  let descuentoPct = Number(input.descuento_porcentaje ?? 0);
  if (!Number.isFinite(descuentoPct) || descuentoPct < 0) descuentoPct = 0;
  if (descuentoPct > 100) descuentoPct = 100;

  let descuentoMonto: number;
  if (input.descuento_porcentaje != null && Number.isFinite(Number(input.descuento_porcentaje))) {
    descuentoMonto = roundCents(bruto * (descuentoPct / 100));
  } else {
    // Compat: borradores viejos con descuento como monto
    descuentoMonto = roundCents(Math.max(0, Number(input.descuento) || 0));
    descuentoPct = bruto > 0 ? roundCents((descuentoMonto / bruto) * 100) : 0;
  }

  if (descuentoMonto > bruto) descuentoMonto = bruto;
  const neto = roundCents(bruto - descuentoMonto);
  const alicuota = isAllowedIvaAlicuota(Number(input.alicuota_iva))
    ? Number(input.alicuota_iva)
    : 21;

  return {
    bruto,
    descuento_porcentaje: descuentoPct,
    descuento_monto: descuentoMonto,
    neto_antes_dto_global: neto,
    alicuota_iva: alicuota,
  };
}

/**
 * Prorratea descuento_total sobre los netos de línea, calcula IVA y totales.
 * Residuo de redondeo → última línea.
 */
export function computeInvoiceAmounts(
  items: InvoiceLineInput[],
  descuentoTotalRaw: number | null | undefined,
): { lines: ComputedInvoiceLine[]; totals: ComputedInvoiceTotals } {
  const partials = items.map(computeLineBeforeGlobalDiscount);
  const sumNeto = roundCents(
    partials.reduce((s, p) => s + p.neto_antes_dto_global, 0),
  );
  let descuentoTotal = roundCents(Math.max(0, Number(descuentoTotalRaw) || 0));
  if (descuentoTotal > sumNeto) descuentoTotal = sumNeto;

  const lines: ComputedInvoiceLine[] = [];
  let assignedDto = 0;

  for (let i = 0; i < partials.length; i += 1) {
    const p = partials[i]!;
    let dtoGlobal = 0;
    if (descuentoTotal > 0 && sumNeto > 0) {
      if (i === partials.length - 1) {
        dtoGlobal = roundCents(descuentoTotal - assignedDto);
      } else {
        dtoGlobal = roundCents((p.neto_antes_dto_global / sumNeto) * descuentoTotal);
        assignedDto = roundCents(assignedDto + dtoGlobal);
      }
    }
    if (dtoGlobal > p.neto_antes_dto_global) dtoGlobal = p.neto_antes_dto_global;
    const netoLinea = roundCents(p.neto_antes_dto_global - dtoGlobal);
    const ivaLinea =
      p.alicuota_iva <= 0 ? 0 : roundCents(netoLinea * (p.alicuota_iva / 100));
    const totalLinea = roundCents(netoLinea + ivaLinea);

    lines.push({
      bruto: p.bruto,
      descuento_porcentaje: p.descuento_porcentaje,
      descuento_monto: p.descuento_monto,
      neto_antes_dto_global: p.neto_antes_dto_global,
      descuento_total_prorrateado: dtoGlobal,
      neto_linea: netoLinea,
      alicuota_iva: p.alicuota_iva,
      iva_linea: ivaLinea,
      total_linea: totalLinea,
      descuento: p.descuento_monto,
      importe: p.neto_antes_dto_global,
    });
  }

  const subtotalBruto = roundCents(lines.reduce((s, l) => s + l.bruto, 0));
  const descuentoLineas = roundCents(lines.reduce((s, l) => s + l.descuento_monto, 0));
  const subtotal = roundCents(lines.reduce((s, l) => s + l.neto_linea, 0));
  const iva = roundCents(lines.reduce((s, l) => s + l.iva_linea, 0));
  const exento = roundCents(
    lines.filter((l) => l.alicuota_iva <= 0).reduce((s, l) => s + l.neto_linea, 0),
  );
  const total = roundCents(subtotal + iva);

  const byMap = new Map<
    number,
    { alicuota: number; neto_gravado: number; iva: number; exento: number; total: number }
  >();
  for (const line of lines) {
    const key = line.alicuota_iva;
    const cur = byMap.get(key) ?? {
      alicuota: key,
      neto_gravado: 0,
      iva: 0,
      exento: 0,
      total: 0,
    };
    if (key <= 0) {
      cur.exento = roundCents(cur.exento + line.neto_linea);
      cur.total = roundCents(cur.total + line.neto_linea);
    } else {
      cur.neto_gravado = roundCents(cur.neto_gravado + line.neto_linea);
      cur.iva = roundCents(cur.iva + line.iva_linea);
      cur.total = roundCents(cur.total + line.total_linea);
    }
    byMap.set(key, cur);
  }

  return {
    lines,
    totals: {
      subtotal_bruto: subtotalBruto,
      descuento_lineas: descuentoLineas,
      descuento_total: descuentoTotal,
      subtotal,
      iva,
      exento,
      total,
      by_alicuota: [...byMap.values()].sort((a, b) => a.alicuota - b.alicuota),
    },
  };
}

/** Aplica cálculos al DTO de factura (fuente de verdad backend). */
export function applyComputedAmountsToInvoice<
  T extends {
    items: Array<
      InvoiceLineInput & {
        descuento?: number;
        descuento_porcentaje?: number;
        alicuota_iva?: number;
        importe?: number;
        neto_linea?: number | null;
        iva_linea?: number | null;
        total_linea?: number | null;
      }
    >;
    totales: {
      subtotal: number | null;
      iva: number | null;
      total: number | null;
      descuento_total?: number | null;
      exento?: number | null;
    };
  },
>(invoice: T): T {
  const { lines, totals } = computeInvoiceAmounts(
    invoice.items,
    invoice.totales.descuento_total,
  );
  return {
    ...invoice,
    items: invoice.items.map((item, i) => {
      const c = lines[i]!;
      return {
        ...item,
        descuento_porcentaje: c.descuento_porcentaje,
        descuento: c.descuento_monto,
        alicuota_iva: c.alicuota_iva,
        importe: c.importe,
        neto_linea: c.neto_linea,
        iva_linea: c.iva_linea,
        total_linea: c.total_linea,
      };
    }),
    totales: {
      ...invoice.totales,
      descuento_total: totals.descuento_total,
      subtotal: totals.subtotal,
      iva: totals.iva,
      exento: totals.exento,
      total: totals.total,
    },
  };
}
