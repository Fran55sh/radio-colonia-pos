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

const MONEY_LINE = /^[\d.,\s]+$/;

function isMoneyLine(line: string): boolean {
  const trimmed = line.trim();
  if (!MONEY_LINE.test(trimmed)) return false;
  return parseMoney(trimmed) > 0;
}

function isUnitLine(line: string): boolean {
  return /^(KG|KE|L|LT|UN|MT|M2|M3|PAR|U)$/i.test(line.trim());
}

function isSupplierProductCode(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 2 || trimmed.length > 12) return false;
  if (/^COD/i.test(trimmed) || /^CANT$/i.test(trimmed)) return false;
  return /^[A-Z]{1,4}\d{1,4}$/i.test(trimmed);
}

function findSectionStart(lines: string[], pattern: RegExp): number {
  return lines.findIndex((line) => pattern.test(line.trim()));
}

function collectUntil(lines: string[], start: number, stop: RegExp[]): string[] {
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) continue;
    if (/^(COD|CANT|DETALL|UNITARIO|TOTAL|SUB\s*TOTAL|I\.?\s*V\.?\s*A|CAE|ORIGINAL)/i.test(trimmed)) {
      if (out.length > 0) break;
    }
    if (stop.some((rx) => rx.test(trimmed))) break;
    out.push(trimmed);
  }
  return out;
}

/** OCR tools often read table columns vertically (COD / CANT / DETALLE stacked). */
function parseItemsFromColumnarOcr(lines: string[]): NormalizedInvoiceItem[] {
  const codIdx = findSectionStart(lines, /^COD$/i);
  const cantIdx = findSectionStart(lines, /^CANT$/i);
  const detalleIdx = findSectionStart(lines, /^DETALL/i);
  const unitIdx = findSectionStart(lines, /^UNITARIO/i);
  const totalIdx = lines.findIndex(
    (line, idx) =>
      /^TOTAL$/i.test(line.trim()) &&
      idx > unitIdx &&
      unitIdx >= 0 &&
      !/^TOTAL\s*\$/i.test(line.trim()),
  );

  if (codIdx < 0 || cantIdx < 0 || detalleIdx < 0 || unitIdx < 0 || totalIdx < 0) {
    return [];
  }

  const codes = collectUntil(lines, codIdx, [/^CANT$/i]).filter(isSupplierProductCode);
  const quantities = collectUntil(lines, cantIdx, [/^DETALL/i, /^KG$/i])
    .filter((line) => !isUnitLine(line))
    .filter((line) => parseMoney(line) > 0);
  const descriptions = collectUntil(lines, detalleIdx, [/^UNITARIO/i, /^CODIGO/i]).filter(
    (line) => line.length > 8 && !/^c\.$/i.test(line),
  );
  const unitPrices = collectUntil(lines, unitIdx, [/^TOTAL$/i, /^c\.$/i]).filter(isMoneyLine);
  const lineTotals = collectUntil(lines, totalIdx, [/^0000/i, /^FECHA/i, /^\*/i, /^SUB/i]).filter(
    isMoneyLine,
  );

  const rows = Math.min(
    codes.length,
    quantities.length,
    descriptions.length,
    unitPrices.length,
    lineTotals.length,
  );
  if (rows === 0) return [];

  const items: NormalizedInvoiceItem[] = [];
  for (let i = 0; i < rows; i += 1) {
    const item = buildItem({
      codigo_proveedor: codes[i]!,
      descripcion: descriptions[i]!,
      cantidad: parseMoney(quantities[i]!),
      precio_unitario: parseMoney(unitPrices[i]!),
      importe: parseMoney(lineTotals[i]!),
    });
    if (item) items.push(item);
  }
  return items;
}

function parseSupplierCuit(lines: string[], flat: string): string | null {
  const header = lines.slice(0, lines.findIndex((l) => /senor|señor|sres|cliente/i.test(l)) || 40);
  for (const line of header) {
    const m = line.match(/C\.?\s*U\.?\s*I\.?\s*T\.?\s*N[°o]?\s*:?\s*([\d\-]+)/i);
    if (m) {
      const cuit = normalizeCuit(m[1]);
      if (cuit) return cuit;
    }
  }
  const cuits = [...flat.matchAll(/\b(\d{2}-?\d{8}-?\d)\b/g)]
    .map((m) => normalizeCuit(m[1]))
    .filter(Boolean) as string[];
  return cuits.find((c) => c.startsWith("30")) ?? cuits[0] ?? null;
}

function parseTotalesFromOcr(lines: string[], flat: string) {
  let subtotal: number | null = null;
  let iva: number | null = null;
  let total: number | null = null;

  const subMatch =
    flat.match(/Imp(?:orte)?\s+Neto(?:\s+Gravado)?\s*:?\s*\$?\s*([\d.,]+)/i) ??
    flat.match(/Sub\s*total[^\d]*([\d]{1,3}(?:\.\d{3})*(?:,\d{2})?)/i);
  if (subMatch) subtotal = parseMoney(subMatch[1]);

  const ivaMatch = flat.match(/I\.?\s*V\.?\s*A\.?[^\d]*([\d]{1,3}(?:\.\d{3})*(?:,\d{2})?)/i);
  if (ivaMatch) iva = parseMoney(ivaMatch[1]);

  const totWithDollar = flat.match(/TOTAL\s*\$\s*([\d]{1,3}(?:\.\d{3})*(?:,\d{2})?)/i);
  if (totWithDollar) {
    total = parseMoney(totWithDollar[1]!);
  } else {
    const allTotals = [...flat.matchAll(/TOTAL\s*:?\s*\$?\s*([\d]{1,3}(?:\.\d{3})*(?:,\d{2})?)/gi)]
      .map((m) => parseMoney(m[1]!))
      .filter((n) => n > 0);
    if (allTotals.length > 0) total = Math.max(...allTotals);
  }

  if (subtotal == null || iva == null || total == null) {
    const moneyAfterSub = lines
      .flatMap((line, idx) => {
        if (!/sub\s*total/i.test(line) && !/subtolal/i.test(line)) return [];
        return lines.slice(idx, idx + 8);
      })
      .filter(isMoneyLine)
      .map(parseMoney)
      .filter((n) => n > 1000);

    if (subtotal == null && moneyAfterSub.length >= 1) subtotal = moneyAfterSub[0]!;
    if (iva == null && moneyAfterSub.length >= 2) iva = moneyAfterSub[1]!;
    if (total == null && moneyAfterSub.length >= 3) total = moneyAfterSub[2]!;
  }

  return { subtotal, iva, total };
}

const HEADER_OR_TOTAL =
  /^(c[oó]digo|c[oó]d\.?|descripci[oó]n|cant\.?|cantidad|precio|p\.?\s*unit|importe|subtotal|total|iva|neto|gravado|unidad|u\.?m\.?)$/i;

const SKIP_LINE =
  /^(factura|original|duplicado|triplicado|cae|vto\.?|fecha|fecna|cuit|domicilio|condici[oó]n|ing\.?\s*brutos|inicio|tel[eé]fono|email|página|page|codigo\s+\d)/i;

function buildItem(input: {
  codigo_proveedor: string | null;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  importe: number;
}): NormalizedInvoiceItem | null {
  if (input.cantidad <= 0 || input.descripcion.length < 2) return null;
  if (HEADER_OR_TOTAL.test(input.descripcion.trim())) return null;
  if (SKIP_LINE.test(input.descripcion.trim())) return null;
  return {
    codigo_proveedor: input.codigo_proveedor,
    descripcion: input.descripcion.trim(),
    cantidad: input.cantidad,
    precio_unitario: input.precio_unitario,
    descuento: 0,
    descuento_porcentaje: 0,
    alicuota_iva: 21,
    importe: input.importe || input.cantidad * input.precio_unitario,
    neto_linea: null,
    iva_linea: null,
    total_linea: null,
    variant_id: null,
    sku: null,
    producto_nombre: null,
    encontrado: false,
    requiere_revision: true,
    confirmar_cambio_mapeo: false,
  };
}

function parseItemsFromStructuredLines(lines: string[]): NormalizedInvoiceItem[] {
  const items: NormalizedInvoiceItem[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || SKIP_LINE.test(trimmed)) continue;

    const strict = trimmed.match(
      /^([A-Za-z0-9\-_./]{2,32})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})\s+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})\s*$/,
    );
    if (strict) {
      const item = buildItem({
        codigo_proveedor: strict[1],
        descripcion: strict[2],
        cantidad: parseMoney(strict[3]),
        precio_unitario: parseMoney(strict[4]),
        importe: parseMoney(strict[5]),
      });
      if (item) items.push(item);
      continue;
    }

    const cols = trimmed.split(/\s{2,}|\t+/).map((c) => c.trim()).filter(Boolean);
    if (cols.length >= 4) {
      const importe = parseMoney(cols[cols.length - 1]!);
      const precio = parseMoney(cols[cols.length - 2]!);
      const cantidad = parseMoney(cols[cols.length - 3]!);
      const firstCol = cols[0] ?? "";
      const codigo =
        cols.length >= 5 && /^[A-Za-z0-9\-_./]{2,32}$/.test(firstCol) ? firstCol : null;
      const descStart = codigo ? 1 : 0;
      const descripcion = cols.slice(descStart, cols.length - 3).join(" ");
      const item = buildItem({
        codigo_proveedor: codigo,
        descripcion,
        cantidad,
        precio_unitario: precio,
        importe,
      });
      if (item) items.push(item);
      continue;
    }

    const trailing = trimmed.match(
      /^(.+?)\s+(\d+(?:[.,]\d+)?)\s+(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+(?:[.,]\d{2}))\s+(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+(?:[.,]\d{2}))\s*$/,
    );
    if (trailing) {
      const item = buildItem({
        codigo_proveedor: null,
        descripcion: trailing[1]!,
        cantidad: parseMoney(trailing[2]!),
        precio_unitario: parseMoney(trailing[3]!),
        importe: parseMoney(trailing[4]!),
      });
      if (item) items.push(item);
      continue;
    }

    const withCode = trimmed.match(
      /^(\d{4,12})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+(?:[.,]\d{2}))\s+(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+(?:[.,]\d{2}))\s*$/,
    );
    if (withCode) {
      const item = buildItem({
        codigo_proveedor: withCode[1]!,
        descripcion: withCode[2]!,
        cantidad: parseMoney(withCode[3]!),
        precio_unitario: parseMoney(withCode[4]!),
        importe: parseMoney(withCode[5]!),
      });
      if (item) items.push(item);
    }
  }

  return items;
}

/** OCR often merges columns; scan for codigo + descripcion + qty + money + money patterns. */
function parseItemsFromOcrBlob(flat: string): NormalizedInvoiceItem[] {
  const items: NormalizedInvoiceItem[] = [];
  const pattern =
    /\b(\d{4,12})\s+([A-Za-zÁÉÍÓÚáéíóúñÑ0-9][A-Za-zÁÉÍÓÚáéíóúñÑ0-9 .,/\-_]{4,80}?)\s+(\d+(?:[.,]\d+)?)\s+(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+(?:[.,]\d{2}))\s+(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+(?:[.,]\d{2}))/g;

  for (const match of flat.matchAll(pattern)) {
    const item = buildItem({
      codigo_proveedor: match[1]!,
      descripcion: match[2]!,
      cantidad: parseMoney(match[3]!),
      precio_unitario: parseMoney(match[4]!),
      importe: parseMoney(match[5]!),
    });
    if (item) items.push(item);
  }

  return items;
}

/**
 * Parser heurístico de facturas argentinas (texto AFIP / electrónico / OCR).
 */
export function parseInvoiceText(text: string): NormalizedInvoice {
  const flat = text.replace(/\r/g, "\n");
  const lines = flat.split("\n").map((l) => l.trim()).filter(Boolean);

  const cuitMatches = [...flat.matchAll(/\b(\d{2}-?\d{8}-?\d)\b/g)].map((m) =>
    normalizeCuit(m[1]),
  );
  const proveedorCuit = parseSupplierCuit(lines, flat) ?? cuitMatches.find(Boolean) ?? null;

  let tipo: string | null = null;
  const tipoMatch =
    flat.match(/Factura\s*([ABC])\b/i) ?? flat.match(/\bCOD\.?\s*0?0?([123])\b/i);
  if (tipoMatch) {
    const t = tipoMatch[1].toUpperCase();
    if (t === "1") tipo = "A";
    else if (t === "6") tipo = "B";
    else if (t === "11") tipo = "C";
    else if (/[ABC]/i.test(t)) tipo = t;
  }

  let puntoVenta: string | null = null;
  let numero: string | null = null;
  const nroMatch =
    flat.match(
      /(?:N[ºo°\.]?\s*(?:Comp(?:robante)?)?|Comp(?:robante)?)\s*:?\s*(\d{1,5})\s*[-–]\s*(\d{1,8})/i,
    ) ?? flat.match(/\b(\d{4,5})\s*[-–]\s*(\d{6,8})\b/);
  if (nroMatch) {
    puntoVenta = padLeft(nroMatch[1], 4);
    numero = padLeft(nroMatch[2], 8);
  }

  let fecha: string | null = null;
  const fechaMatch =
    flat.match(/Fec(?:ha|na)(?:\s+de\s+emisi[oó]n)?\s*:?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i) ??
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
        /(S\.?\s*A\.?|S\.?\s*R\.?\s*L\.?|S\.?\s*H\.?)/i.test(l) &&
        l.length > 5 &&
        l.length < 80 &&
        !/CUIT|IVA|Factura|CODIGO|Código|DOMICILIO|Fecha|Fecna|CAE|Original/i.test(l),
    );
    razonSocial = candidate ?? null;
  }

  const condicionMatch = flat.match(/Condici[oó]n\s+(?:frente\s+al\s+)?IVA\s*:?\s*([^\n]+)/i);
  const condicionIva = condicionMatch?.[1]?.trim() ?? null;

  let items = parseItemsFromColumnarOcr(lines);
  if (items.length === 0) items = parseItemsFromStructuredLines(lines);
  if (items.length === 0) items = parseItemsFromOcrBlob(flat.replace(/\n+/g, " "));

  const totalesParsed = parseTotalesFromOcr(lines, flat);
  let subtotal = totalesParsed.subtotal;
  let iva = totalesParsed.iva;
  let total = totalesParsed.total;

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
      se_creara: false,
    },
    factura: {
      tipo,
      punto_venta: puntoVenta,
      numero,
      fecha,
      condicion_iva: condicionIva,
    },
    items,
    totales: { subtotal, iva, total, descuento_total: 0, exento: 0 },
  };
}
