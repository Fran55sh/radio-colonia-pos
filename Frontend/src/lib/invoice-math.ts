/** Previsualización FE — el backend recalcula al guardar/ejecutar. */

export const IVA_OPTIONS = [0, 10.5, 21, 27] as const;

export function roundCents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type LinePreviewInput = {
  cantidad: number;
  precio_unitario: number;
  descuento_porcentaje?: number | null;
  alicuota_iva?: number | null;
};

export function previewLine(input: LinePreviewInput, dtoGlobalShare = 0) {
  const bruto = roundCents((Number(input.cantidad) || 0) * (Number(input.precio_unitario) || 0));
  let pct = Number(input.descuento_porcentaje) || 0;
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  const descuentoMonto = roundCents(bruto * (pct / 100));
  const netoAntes = roundCents(bruto - descuentoMonto);
  const dtoG = Math.min(netoAntes, roundCents(Math.max(0, dtoGlobalShare)));
  const neto = roundCents(netoAntes - dtoG);
  const alicuota = Number(input.alicuota_iva) || 0;
  const iva = alicuota <= 0 ? 0 : roundCents(neto * (alicuota / 100));
  return {
    bruto,
    descuento_porcentaje: pct,
    descuento: descuentoMonto,
    importe: netoAntes,
    neto_linea: neto,
    iva_linea: iva,
    total_linea: roundCents(neto + iva),
    alicuota_iva: alicuota,
  };
}

export function previewInvoiceTotals(
  items: LinePreviewInput[],
  descuentoTotalRaw: number | null | undefined,
) {
  const partials = items.map((i) => previewLine(i));
  const sumNeto = roundCents(partials.reduce((s, p) => s + p.importe, 0));
  let descuentoTotal = roundCents(Math.max(0, Number(descuentoTotalRaw) || 0));
  if (descuentoTotal > sumNeto) descuentoTotal = sumNeto;

  let assigned = 0;
  const lines = partials.map((p, i) => {
    let share = 0;
    if (descuentoTotal > 0 && sumNeto > 0) {
      if (i === partials.length - 1) share = roundCents(descuentoTotal - assigned);
      else {
        share = roundCents((p.importe / sumNeto) * descuentoTotal);
        assigned = roundCents(assigned + share);
      }
    }
    return previewLine(items[i]!, share);
  });

  const subtotal = roundCents(lines.reduce((s, l) => s + l.neto_linea, 0));
  const iva = roundCents(lines.reduce((s, l) => s + l.iva_linea, 0));
  return {
    lines,
    descuento_total: descuentoTotal,
    subtotal,
    iva,
    total: roundCents(subtotal + iva),
  };
}
