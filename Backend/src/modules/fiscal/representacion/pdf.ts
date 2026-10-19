import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { FacturaRepresentacion } from "./modelo.js";

export const TEXTO_COMPROBANTE_AUTORIZADO = "Comprobante Autorizado";
export const TEXTO_RESPONSABILIDAD =
  "Esta Administración Federal no se responsabiliza por los datos ingresados en el detalle de la operación";
export const TEXTO_TRANSPARENCIA = "Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 28;
const CONTENT_W = PAGE_W - M * 2;
const INK = "#000000";
const FOOTER_H = 156;

type Col = {
  key: keyof FacturaRepresentacion["lineas"][number];
  label: string;
  width: number;
  align: "left" | "right" | "center";
};

type Doc = InstanceType<typeof PDFDocument>;

function columnas(model: FacturaRepresentacion): Col[] {
  if (model.discriminaIva) {
    const fixed = [58, 34, 40, 40, 74, 46, 80];
    const desc = CONTENT_W - fixed.reduce((sum, width) => sum + width, 0);
    const widths = [fixed[0], desc, ...fixed.slice(1)];
    const spec: Array<Omit<Col, "width">> = [
      { key: "codigo", label: "Código", align: "left" },
      { key: "descripcion", label: "Descripción", align: "left" },
      { key: "cantidad", label: "Cant.", align: "right" },
      { key: "unidad", label: "U. med.", align: "center" },
      { key: "alicuota", label: "Alíc.", align: "right" },
      { key: "precioUnitario", label: "P. unit. neto", align: "right" },
      { key: "bonificacion", label: "% Bonif.", align: "right" },
      { key: "importe", label: "Importe", align: "right" },
    ];
    return spec.map((col, index) => ({ ...col, width: widths[index] }));
  }
  const fixed = [64, 36, 44, 76, 48, 82];
  const desc = CONTENT_W - fixed.reduce((sum, width) => sum + width, 0);
  const widths = [fixed[0], desc, ...fixed.slice(1)];
  const spec: Array<Omit<Col, "width">> = [
    { key: "codigo", label: "Código", align: "left" },
    { key: "descripcion", label: "Descripción", align: "left" },
    { key: "cantidad", label: "Cant.", align: "right" },
    { key: "unidad", label: "U. med.", align: "center" },
    { key: "precioUnitario", label: "P. unit.", align: "right" },
    { key: "bonificacion", label: "% Bonif.", align: "right" },
    { key: "importe", label: "Importe", align: "right" },
  ];
  return spec.map((col, index) => ({ ...col, width: widths[index] }));
}

function cellText(row: FacturaRepresentacion["lineas"][number], key: Col["key"]): string {
  const value = row[key];
  return value ?? "";
}

function rowHeight(doc: Doc, row: FacturaRepresentacion["lineas"][number], cols: Col[]): number {
  doc.font("Helvetica").fontSize(8);
  let height = 12;
  for (const col of cols) {
    const text = cellText(row, col.key);
    height = Math.max(height, doc.heightOfString(text, { width: col.width - 4 }) + 4);
  }
  return height;
}

function drawRow(
  doc: Doc,
  row: FacturaRepresentacion["lineas"][number],
  cols: Col[],
  y: number,
  height: number,
  header = false,
): void {
  let x = M;
  doc.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(header ? 7 : 8).fillColor(INK);
  for (const col of cols) {
    const text = header ? col.label : cellText(row, col.key);
    doc.text(text, x + 2, y + 2, {
      width: col.width - 4,
      align: col.align,
      lineBreak: true,
    });
    x += col.width;
  }
  doc.moveTo(M, y + height).lineTo(M + CONTENT_W, y + height).strokeColor(INK).lineWidth(0.4).stroke();
}

function drawTableHeader(doc: Doc, cols: Col[], y: number): number {
  const headerRow = {
    codigo: "",
    descripcion: "",
    cantidad: "",
    unidad: "",
    alicuota: "",
    precioUnitario: "",
    bonificacion: "",
    importe: "",
  };
  const height = 16;
  doc.rect(M, y, CONTENT_W, height).strokeColor(INK).lineWidth(0.8).stroke();
  drawRow(doc, headerRow, cols, y, height, true);
  return y + height;
}

function drawParty(doc: Doc, lines: string[], x: number, y: number, width: number): void {
  let cursor = y;
  lines.forEach((line, index) => {
    doc.font(index === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(index === 0 ? 11 : 8).fillColor(INK);
    const h = doc.heightOfString(line, { width });
    doc.text(line, x, cursor, { width, lineBreak: true });
    cursor += h + 1;
  });
}

function drawHeader(doc: Doc, model: FacturaRepresentacion, continued: boolean): number {
  doc.fillColor(INK).strokeColor(INK);
  if (continued) {
    doc.font("Helvetica-Bold").fontSize(9).text(
      `${model.titulo} ${model.letra}  ${model.numeroVisual}  (continuación)`,
      M,
      M + 8,
      { width: CONTENT_W - 80, lineBreak: false },
    );
    return M + 28;
  }

  let y = M;
  doc.font("Helvetica-Bold").fontSize(9).text("ORIGINAL", M, y, { width: 120, lineBreak: false });
  y += 14;
  if (model.ambiente !== "prod") {
    doc.font("Helvetica-Bold").fontSize(8).text(
      "HOMOLOGACIÓN — SIN VALIDEZ FISCAL",
      M,
      y,
      { width: CONTENT_W, align: "center", lineBreak: false },
    );
    y += 14;
  }

  const boxTop = y;
  const boxH = 96;
  const mid = M + CONTENT_W / 2;
  const gap = 26;
  doc.lineWidth(1).strokeColor(INK);
  doc.rect(M, boxTop, mid - M - gap, boxH).stroke();
  doc.rect(mid + gap, boxTop, PAGE_W - M - (mid + gap), boxH).stroke();

  const side = 48;
  const letterX = mid - side / 2;
  const letterY = boxTop + 18;
  doc.rect(letterX, letterY, side, side).fillAndStroke("#ffffff", INK);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(22).text(model.letra, letterX, letterY + 6, {
    width: side,
    align: "center",
    lineBreak: false,
  });
  doc.font("Helvetica").fontSize(7).text(`COD. ${model.codigo}`, letterX, letterY + 32, {
    width: side,
    align: "center",
    lineBreak: false,
  });

  drawParty(doc, [
    model.emisor.razonSocial,
    `Domicilio comercial: ${model.emisor.domicilio}`,
    `Condición frente al IVA: ${model.emisor.condicionIva}`,
  ], M + 8, boxTop + 8, mid - M - gap - 16);

  drawParty(doc, [
    model.titulo,
    `Punto de venta: ${model.puntoVentaTexto}`,
    `Comp. nro: ${model.cbteNroTexto}`,
    `Fecha de emisión: ${model.fechaEmision}`,
    `CUIT: ${model.emisor.cuit}`,
    `Ingresos brutos: ${model.emisor.ingresosBrutos}`,
    `Inicio de actividades: ${model.emisor.inicioActividades}`,
  ], mid + gap + 8, boxTop + 6, PAGE_W - M - (mid + gap) - 16);

  return boxTop + boxH + 8;
}

function drawReceptor(doc: Doc, model: FacturaRepresentacion, y: number): number {
  const lines = [
    leyendaReceptor(model),
    `Apellido y nombre / Razón social: ${model.receptor.nombre}`,
    `Domicilio: ${model.receptor.domicilio}`,
    `Condición frente al IVA: ${model.receptor.condicionIva}`,
    model.receptor.documento,
  ].filter((line) => line.length > 0);
  doc.font("Helvetica").fontSize(8);
  const inner = lines.reduce((sum, line) => sum + doc.heightOfString(line, { width: CONTENT_W - 12 }) + 2, 8);
  const height = Math.max(52, inner);
  doc.rect(M, y, CONTENT_W, height).lineWidth(0.8).strokeColor(INK).stroke();
  let cursor = y + 4;
  for (const line of lines) {
    const bold = line.startsWith("A CONSUMIDOR FINAL");
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8).fillColor(INK);
    const h = doc.heightOfString(line, { width: CONTENT_W - 12 });
    doc.text(line, M + 6, cursor, { width: CONTENT_W - 12 });
    cursor += h + 2;
  }
  return y + height + 6;
}

function leyendaReceptor(model: FacturaRepresentacion): string {
  return model.receptor.leyendaConsumidorFinal ? "A CONSUMIDOR FINAL" : "";
}

function drawCondicion(doc: Doc, model: FacturaRepresentacion, y: number): number {
  const partes = [
    `Condición de venta: ${model.condicionVenta}`,
    `Medio de pago: ${model.medioPago}`,
    `Moneda: ${model.moneda}`,
    `Cotización: ${model.cotizacion}`,
  ];
  if (model.concepto) partes.push(`Concepto: ${model.concepto}`);
  doc.font("Helvetica").fontSize(8).fillColor(INK).text(partes.join("   "), M, y, {
    width: CONTENT_W,
  });
  return y + 16;
}

function bloqueTotales(model: FacturaRepresentacion): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (model.totales.netoGravado) rows.push(["Importe neto gravado", model.totales.netoGravado]);
  for (const iva of model.totales.iva) rows.push([iva.etiqueta, iva.importe]);
  if (model.totales.exento) rows.push(["Importe exento", model.totales.exento]);
  if (model.totales.otrosTributos) rows.push(["Otros tributos", model.totales.otrosTributos]);
  rows.push(["Importe total", model.totales.total]);
  return rows;
}

function alturaTotales(model: FacturaRepresentacion): number {
  const filas = bloqueTotales(model).length * 14 + 8;
  const trans = model.transparencia ? 28 + model.transparencia.iva.length * 12 + 16 : 0;
  return Math.max(filas, trans);
}

function drawTotales(doc: Doc, model: FacturaRepresentacion, y: number): number {
  const height = alturaTotales(model);
  const rightW = 230;
  const leftW = CONTENT_W - rightW - 8;
  if (model.transparencia) {
    doc.font("Helvetica-Bold").fontSize(8).fillColor(INK).text(TEXTO_TRANSPARENCIA, M, y, {
      width: leftW,
    });
    let cursor = y + 22;
    for (const iva of model.transparencia.iva) {
      doc.font("Helvetica").fontSize(8).text(`${iva.etiqueta}: ${iva.importe}`, M, cursor, { width: leftW });
      cursor += 12;
    }
    doc.text(`Otros impuestos nacionales indirectos: ${model.transparencia.otrosImpuestos}`, M, cursor, {
      width: leftW,
    });
  }
  let cursor = y;
  const x = M + CONTENT_W - rightW;
  for (const [label, value] of bloqueTotales(model)) {
    const last = label === "Importe total";
    doc.font(last ? "Helvetica-Bold" : "Helvetica").fontSize(last ? 10 : 8).fillColor(INK);
    doc.text(label, x, cursor, { width: rightW - 78, align: "right", lineBreak: false });
    doc.text(value, x + rightW - 74, cursor, { width: 74, align: "right", lineBreak: false });
    cursor += last ? 16 : 13;
  }
  return y + height;
}

function drawFooter(doc: Doc, model: FacturaRepresentacion, qr: Buffer, y: number): void {
  const top = Math.max(y + 8, PAGE_H - M - FOOTER_H);
  doc.image(qr, M, top, { width: 92, height: 92 });
  doc.font("Helvetica").fontSize(8).fillColor(INK);
  const textX = M + 104;
  const textW = CONTENT_W - 104;
  doc.font("Helvetica-Bold").text(`CAE N°: ${model.cae}`, textX, top + 8, { width: textW });
  doc.font("Helvetica").text(`Fecha de vto. de CAE: ${model.caeVencimiento}`, textX, top + 24, { width: textW });
  doc.font("Helvetica-Bold").text(TEXTO_COMPROBANTE_AUTORIZADO, textX, top + 46, { width: textW });
  doc.font("Helvetica").fontSize(7).text(TEXTO_RESPONSABILIDAD, textX, top + 62, { width: textW });
  doc.font("Helvetica").fontSize(7).text(
    model.discriminaIva
      ? "Importes de ítems netos de IVA. El importe de cada renglón es el neto persistido."
      : "Importes de ítems con IVA incluido.",
    M,
    top + 108,
    { width: CONTENT_W },
  );
}

function necesitaPagina(y: number, altura: number, reservaInferior: number): boolean {
  return y + altura > PAGE_H - M - reservaInferior;
}

export async function renderFacturaPdf(model: FacturaRepresentacion): Promise<Buffer> {
  const qr = await QRCode.toBuffer(model.qrUrl, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 256,
  });
  const cols = columnas(model);

  const doc = new PDFDocument({
    size: "A4",
    margin: M,
    bufferPages: true,
    compress: true,
    lang: "es-AR",
    info: {
      Title: model.archivo.replace(/\.pdf$/i, ""),
      Author: model.emisor.razonSocial,
      Creator: "Radio Colonia POS",
      Producer: "Radio Colonia POS",
      CreationDate: model.fechaPdf,
      ModDate: model.fechaPdf,
    },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  let y = drawHeader(doc, model, false);
  y = drawReceptor(doc, model, y);
  y = drawCondicion(doc, model, y);
  y = drawTableHeader(doc, cols, y);

  for (const linea of model.lineas) {
    const height = rowHeight(doc, linea, cols);
    if (necesitaPagina(y, height, 8)) {
      doc.addPage();
      y = drawHeader(doc, model, true);
      y = drawTableHeader(doc, cols, y);
    }
    doc.rect(M, y, CONTENT_W, height).strokeColor(INK).lineWidth(0.3).stroke();
    drawRow(doc, linea, cols, y, height);
    y += height;
  }

  const totalsH = alturaTotales(model);
  if (necesitaPagina(y, totalsH + FOOTER_H, 0)) {
    doc.addPage();
    y = drawHeader(doc, model, true);
  }
  y = drawTotales(doc, model, y + 8);
  drawFooter(doc, model, qr, y);

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(8).fillColor(INK).text(
      `Pág. ${i + 1}/${range.count}`,
      PAGE_W - M - 70,
      14,
      { width: 70, align: "right", lineBreak: false },
    );
  }

  doc.end();
  return done;
}
