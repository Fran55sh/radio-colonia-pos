import type { NormalizedInvoice, NormalizedInvoiceItem } from "./schemas.js";

function normalizeCuit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

function parseMoney(raw: string): number {
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function padLeft(value: string, len: number): string {
  return value.replace(/\D/g, "").padStart(len, "0").slice(-len);
}

function parseFecha(raw: string): string | null {
  const m = raw.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return null;
  const d = m[1].padStart(2, "0");
  const mo = m[2].padStart(2, "0");
  let y = m[3];
  if (y.length === 2) y = `20${y}`;
  return `${y}-${mo}-${d}`;
}

/**
 * Parser heurístico de facturas argentinas (texto AFIP / electrónico).
 * No usa IA. Si el layout no matchea, items puede quedar vacío → revisión manual.
 */
export function parseInvoiceText(text: string): NormalizedInvoice {
  const flat = text.replace(/\r/g, "\n");
  const lines = flat.split("\n").map((l) => l.trim()).filter(Boolean);

  const cuitMatches = [...flat.matchAll(/\b(\d{2}-?\d{8}-?\d)\b/g)].map((m) =>
    normalizeCuit(m[1]),
  );
  const proveedorCuit = cuitMatches.find(Boolean) ?? null;

  let tipo: string | null = null;
  const tipoMatch = flat.match(/Factura\s*([ABC])\b/i) ?? flat.match(/\bCOD\.?\s*0?0?([123])\b/i);
  if (tipoMatch) {
    const t = tipoMatch[1].toUpperCase();
    tipo = t === "1" ? "A" : t === "6" || t === "2" ? "B" : t.length === 1 ? t : "A";
    if (t === "1") tipo = "A";
    else if (t === "6") tipo = "B";
    else if (t === "11") tipo = "C";
    else if (/[ABC]/i.test(t)) tipo = t;
  }

  let puntoVenta: string | null = null;
  let numero: string | null = null;
  const nroMatch =
    flat.match(/(?:N[ºo°\.]?\s*(?:Comp(?:robante)?)?|Comp(?:robante)?)\s*:?\s*(\d{1,5})\s*[-–]\s*(\d{1,8})/i) ??
    flat.match(/\b(\d{4,5})\s*[-–]\s*(\d{6,8})\b/);
  if (nroMatch) {
    puntoVenta = padLeft(nroMatch[1], 4);
    numero = padLeft(nroMatch[2], 8);
  }

  let fecha: string | null = null;
  const fechaMatch =
    flat.match(/Fecha(?:\s+de\s+emisi[oó]n)?\s*:?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i) ??
    flat.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})\b/);
  if (fechaMatch) fecha = parseFecha(fechaMatch[1]);

  let razonSocial: string | null = null;
  for (const line of lines.slice(0, 40)) {
    if (/raz[oó]n\s+social/i.test(line)) {
      razonSocial = line.split(/:/).slice(1).join(":").trim() || null;
      break;
    }
  }
  if (!razonSocial) {
    const candidate = lines.find(
      (l) =>
        l.length > 5 &&
        l.length < 80 &&
        !/CUIT|IVA|Factura|Punto|Fecha|CAE|Original/i.test(l) &&
        /[A-Za-zÁÉÍÓÚáéíóúñÑ]{4}/.test(l),
    );
    razonSocial = candidate ?? null;
  }

  const condicionMatch = flat.match(/Condici[oó]n\s+(?:frente\s+al\s+)?IVA\s*:?\s*([^\n]+)/i);
  const condicionIva = condicionMatch?.[1]?.trim() ?? null;

  const items: NormalizedInvoiceItem[] = [];
  for (const line of lines) {
    // código + descripción + cantidad + precio + importe (heurística)
    const m = line.match(
      /^([A-Za-z0-9\-_./]{2,32})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})\s+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})\s*$/,
    );
    if (!m) continue;
    const codigo = m[1];
    const descripcion = m[2].trim();
    const cantidad = parseMoney(m[3]);
    const precio = parseMoney(m[4]);
    const importe = parseMoney(m[5]);
    if (cantidad <= 0 || descripcion.length < 2) continue;
    if (/^(código|codigo|cant|precio|importe|desc)/i.test(codigo)) continue;
    items.push({
      codigo_proveedor: codigo,
      descripcion,
      cantidad,
      precio_unitario: precio,
      descuento: 0,
      importe: importe || cantidad * precio,
      variant_id: null,
      sku: null,
      producto_nombre: null,
      encontrado: false,
      requiere_revision: true,
    });
  }

  // Fallback: líneas con solo descripción + qty + importe
  if (items.length === 0) {
    for (const line of lines) {
      const m = line.match(
        /^(.{5,80}?)\s+(\d+(?:[.,]\d+)?)\s+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})\s+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})\s*$/,
      );
      if (!m) continue;
      const descripcion = m[1].trim();
      if (/total|subtotal|iva|cuit|factura/i.test(descripcion)) continue;
      const cantidad = parseMoney(m[2]);
      const precio = parseMoney(m[3]);
      const importe = parseMoney(m[4]);
      if (cantidad <= 0) continue;
      items.push({
        codigo_proveedor: null,
        descripcion,
        cantidad,
        precio_unitario: precio,
        descuento: 0,
        importe: importe || cantidad * precio,
        variant_id: null,
        sku: null,
        producto_nombre: null,
        encontrado: false,
        requiere_revision: true,
      });
    }
  }

  let subtotal: number | null = null;
  let iva: number | null = null;
  let total: number | null = null;

  const subMatch = flat.match(/Imp(?:orte)?\s+Neto(?:\s+Gravado)?\s*:?\s*\$?\s*([\d.,]+)/i)
    ?? flat.match(/Subtotal\s*:?\s*\$?\s*([\d.,]+)/i);
  if (subMatch) subtotal = parseMoney(subMatch[1]);

  const ivaMatch = flat.match(/IVA\s*(?:21\s*%?)?\s*:?\s*\$?\s*([\d.,]+)/i);
  if (ivaMatch) iva = parseMoney(ivaMatch[1]);

  const totMatch = flat.match(/Total\s*:?\s*\$?\s*([\d.,]+)/i);
  if (totMatch) total = parseMoney(totMatch[1]);

  if (subtotal == null && items.length > 0) {
    subtotal = items.reduce((s, i) => s + i.importe, 0);
  }
  if (total == null && subtotal != null) {
    total = iva != null ? subtotal + iva : subtotal;
  }

  return {
    proveedor: {
      cuit: proveedorCuit,
      razon_social: razonSocial,
      proveedor_id: null,
    },
    factura: {
      tipo,
      punto_venta: puntoVenta,
      numero,
      fecha,
      condicion_iva: condicionIva,
    },
    items,
    totales: { subtotal, iva, total },
  };
}
