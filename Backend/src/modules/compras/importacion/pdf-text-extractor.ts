import { readFile } from "fs/promises";
import { createRequire } from "module";
import { PasswordException, PDFParse } from "pdf-parse";
import { AppError } from "../../../middleware/errors.js";

const require = createRequire(import.meta.url);
type LegacyPdfParse = (buffer: Buffer) => Promise<{ text?: string }>;
const legacyPdfParse = require("legacy-pdf-parse/lib/pdf-parse.js") as LegacyPdfParse;

const MIN_TEXT_LEN = 20;

const MSG_NO_TEXT =
  "El PDF no tiene texto seleccionable.\n\n" +
  "Usá el PDF original de AFIP/ARCA (factura electrónica), no una foto ni un escaneo.\n" +
  "Tip: abrí el PDF y verificá que podés seleccionar texto con el mouse.";

const MSG_PASSWORD =
  "El PDF está protegido con contraseña.\n\n" +
  "Descargá o exportá una copia sin protección e intentá de nuevo.";

const MSG_CORRUPT =
  "No se pudo abrir el PDF.\n\n" +
  "Verificá que el archivo no esté corrupto y que sea un PDF válido.";

function normalizeExtractedText(result: {
  text?: string;
  pages?: Array<{ text?: string }>;
}): string {
  const fromPages = (result.pages ?? [])
    .map((page) => page.text?.trim())
    .filter(Boolean)
    .join("\n\n");
  return (result.text ?? "").trim() || fromPages.trim();
}

async function extractWithV2(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return normalizeExtractedText(result);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractWithLegacy(buffer: Buffer): Promise<string> {
  const result = await legacyPdfParse(buffer);
  return (result.text ?? "").trim();
}

function isPasswordError(err: unknown): boolean {
  if (err instanceof PasswordException) return true;
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return message.includes("password");
}

/**
 * Adapter de extracción de texto. Intercambiable por OCR/IA más adelante.
 * Contrato: buffer → string de texto plano.
 */
export async function extractPdfTextFromBuffer(buffer: Buffer): Promise<string> {
  if (buffer.length === 0) {
    throw new AppError(400, "PDF_EMPTY", MSG_CORRUPT);
  }

  let v2Text = "";
  let v2Failed = false;

  try {
    v2Text = await extractWithV2(buffer);
    if (v2Text.length >= MIN_TEXT_LEN) return v2Text;
  } catch (err) {
    v2Failed = true;
    if (isPasswordError(err)) {
      throw new AppError(400, "PDF_PASSWORD", MSG_PASSWORD);
    }
    console.warn("[compras] pdf-parse v2 falló:", err);
  }

  try {
    const legacyText = await extractWithLegacy(buffer);
    if (legacyText.length >= MIN_TEXT_LEN) return legacyText;
    if (!v2Failed && v2Text.length > 0 && legacyText.length > v2Text.length) {
      return legacyText;
    }
  } catch (err) {
    if (isPasswordError(err)) {
      throw new AppError(400, "PDF_PASSWORD", MSG_PASSWORD);
    }
    console.warn("[compras] pdf-parse legacy falló:", err);
  }

  if (v2Text.length > 0 || !v2Failed) {
    throw new AppError(400, "PDF_NO_TEXT", MSG_NO_TEXT);
  }

  throw new AppError(400, "PDF_PARSE_ERROR", MSG_CORRUPT);
}

export async function extractPdfText(absolutePath: string): Promise<string> {
  let buffer: Buffer;
  try {
    buffer = await readFile(absolutePath);
  } catch {
    throw new AppError(400, "PDF_READ_ERROR", "No se pudo leer el archivo PDF del disco");
  }

  return extractPdfTextFromBuffer(buffer);
}
