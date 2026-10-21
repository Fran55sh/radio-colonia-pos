import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CbteTipo } from "@ramiidv/arca-facturacion";
import type { EmisorPresentacion } from "./emisor.js";
import { formatImporte } from "./formato.js";
import { armarRepresentacion, type FacturaPersistida, type LineaPersistida } from "./modelo.js";
import { renderFacturaPdf, TEXTO_COMPROBANTE_AUTORIZADO, TEXTO_TRANSPARENCIA } from "./pdf.js";

const emisor: EmisorPresentacion = {
  razonSocial: "Radio Colonia",
  domicilio: "Calle 1 123",
  condicionIva: "IVA Responsable Inscripto",
  ingresosBrutos: "901-000",
  inicioActividades: "2010-05-01",
};

function linea(partial: Partial<LineaPersistida> & Pick<LineaPersistida, "codigo" | "descripcion">): LineaPersistida {
  return {
    cantidad: 1,
    precioUnitario: 100,
    alicuota: 21,
    neto: 82.64,
    iva: 17.36,
    exento: 0,
    total: 100,
    ...partial,
  };
}

function factura(partial: Partial<FacturaPersistida> = {}): FacturaPersistida {
  return {
    ventaId: 10,
    estado: "emitido",
    ambiente: "dev",
    emisorCuit: "20111111112",
    puntoVenta: 2,
    cbteTipo: CbteTipo.FACTURA_B,
    cbteNro: 1234,
    fechaCbte: "2026-10-17",
    cae: "71234567890123",
    caeVencimiento: "2026-10-27",
    qrUrl: "https://www.afip.gob.ar/fe/qr/?p=persistido-test",
    docTipo: 99,
    docNro: 0,
    condicionIvaReceptorId: 5,
    netoGravado: 82.64,
    ivaTotal: 17.36,
    exento: 0,
    total: 100,
    impTotalEnviado: 100,
    ivaDetalle: [{ id: 5, base: 82.64, importe: 17.36 }],
    moneda: "PES",
    cotizacion: 1,
    impTrib: 0,
    concepto: 1,
    medioPago: "Efectivo",
    receptor: null,
    lineas: [linea({ codigo: "SKU-1", descripcion: "Radio portatil" })],
    ...partial,
  };
}

function extractPdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const inflated: string[] = [];
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of raw.matchAll(streams)) {
    try {
      inflated.push(inflateSync(Buffer.from(match[1], "latin1")).toString("latin1"));
    } catch {
      // El stream no está comprimido: el texto queda en el PDF crudo.
    }
  }
  const source = inflated.length > 0 ? `${raw}\n${inflated.join("\n")}` : raw;
  const literals: string[] = [];
  const hexParts: string[] = [];
  const literal = /\((?:\\[0-7]{1,3}|\\.|[^\\)])*\)/g;
  const hex = /<([0-9A-Fa-f\s]{2,})>/g;
  for (const match of source.match(literal) ?? []) {
    literals.push(decodePdfLiteral(match.slice(1, -1)));
  }
  for (const match of source.matchAll(hex)) {
    hexParts.push(decodeHex(match[1]));
  }
  return `${literals.join("\n")}\n${hexParts.join("")}`;
}

function decodeHex(hex: string): string {
  const clean = hex.replace(/\s/g, "");
  if (clean.length % 2 !== 0) return "";
  let out = "";
  for (let i = 0; i < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}

function decodePdfLiteral(body: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      out += body[i];
      continue;
    }
    const next = body[i + 1];
    if (next === "n") {
      out += "\n";
      i += 1;
      continue;
    }
    if (next === "r" || next === "t") {
      out += next === "r" ? "\r" : "\t";
      i += 1;
      continue;
    }
    if (next === "(" || next === ")" || next === "\\") {
      out += next;
      i += 1;
      continue;
    }
    if (next && next >= "0" && next <= "7") {
      let oct = next;
      let j = i + 2;
      for (let k = 0; k < 2 && j < body.length && body[j] >= "0" && body[j] <= "7"; k += 1, j += 1) {
        oct += body[j];
      }
      out += String.fromCharCode(parseInt(oct, 8));
      i = j - 1;
      continue;
    }
    out += next ?? "";
    i += 1;
  }
  return out;
}

function paginas(buf: Buffer): number {
  return buf.toString("latin1").match(/\/Type \/Page(?!s)/g)?.length ?? 0;
}

describe("renderFacturaPdf", () => {
  it("repite el mismo PDF y conserva CAE, total y leyendas de una Factura B", async () => {
    const model = armarRepresentacion(factura(), emisor);
    const first = await renderFacturaPdf(model);
    const second = await renderFacturaPdf(model);
    expect(Buffer.compare(first, second)).toBe(0);
    const text = extractPdfText(first);
    expect(text).toContain("71234567890123");
    expect(text).toContain(formatImporte(100));
    expect(text).toContain(formatImporte(17.36));
    expect(text).toContain(TEXTO_COMPROBANTE_AUTORIZADO);
    expect(text).toContain(TEXTO_TRANSPARENCIA);
    expect(text).toContain("SIN VALIDEZ FISCAL");
    expect(text).toContain("Radio portatil");
    expect(text).toContain("20-11111111-2");
    expect(paginas(first)).toBeGreaterThan(0);
  });

  it("Factura A muestra el neto persistido y no el recuadro de transparencia", async () => {
    const model = armarRepresentacion(
      factura({
        ambiente: "prod",
        cbteTipo: CbteTipo.FACTURA_A,
        docTipo: 80,
        docNro: 20123456786,
        condicionIvaReceptorId: 1,
        netoGravado: 82.64,
        receptor: {
          nombre: "Ada",
          razonSocial: "ACME SA",
          domicilio: "Mitre 50",
          email: null,
          telefono: null,
        },
        lineas: [linea({ codigo: "A1", descripcion: "Equipo A", cantidad: 2, precioUnitario: 50, neto: 82.64, total: 100 })],
      }),
      emisor,
    );
    const text = extractPdfText(await renderFacturaPdf(model));
    expect(text).toContain("Importe neto gravado");
    expect(text).toContain(formatImporte(82.64));
    expect(text).toContain("ACME SA");
    expect(text).not.toContain(TEXTO_TRANSPARENCIA);
    expect(text).not.toContain("SIN VALIDEZ FISCAL");
    expect(text).not.toContain(formatImporte(50));
  });

  it("Factura C conserva el total y el IVA contenido en cero", async () => {
    const model = armarRepresentacion(
      factura({
        cbteTipo: CbteTipo.FACTURA_C,
        ivaDetalle: [],
        ivaTotal: 0,
        netoGravado: 0,
        total: 80,
        impTotalEnviado: 80,
        lineas: [linea({ codigo: "C1", descripcion: "Item C", precioUnitario: 80, alicuota: 0, neto: 0, iva: 0, total: 80 })],
      }),
      emisor,
    );
    const text = extractPdfText(await renderFacturaPdf(model));
    expect(text).toContain("Item C");
    expect(text).toContain(formatImporte(80));
    expect(text).toContain("IVA Contenido");
    expect(text).not.toContain("Importe neto gravado");
  });

  it("varias líneas pasan a otra página sin perder el último ítem ni el CAE", async () => {
    const lineas = Array.from({ length: 40 }, (_, index) =>
      linea({
        codigo: `SKU-${index + 1}`,
        descripcion: `Producto largo numero ${index + 1} con descripcion de renglón`,
        cantidad: index + 1,
        precioUnitario: 10,
        neto: 8.26,
        iva: 1.74,
        total: 10,
      }),
    );
    const model = armarRepresentacion(
      factura({
        lineas,
        total: 400,
        impTotalEnviado: 400,
        netoGravado: 330.58,
        ivaTotal: 69.42,
      }),
      emisor,
    );
    const buf = await renderFacturaPdf(model);
    const text = extractPdfText(buf);
    expect(paginas(buf)).toBeGreaterThan(1);
    expect(text).toContain("Producto largo numero 1 ");
    expect(text).toContain("Producto largo numero 40 ");
    expect(text).toContain("71234567890123");
    expect(text.split("71234567890123").length - 1).toBe(1);
  });
});
