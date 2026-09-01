import { readFile } from "fs/promises";
import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { DocumentInitParameters } from "pdfjs-dist/types/src/display/api.js";
import { PasswordException, PDFParse, type LoadParameters } from "pdf-parse";
import { AppError } from "../../../middleware/errors.js";
import { extractWithGemini, isGeminiExtractionEnabled } from "./pdf-gemini.js";
import { extractWithPdftotext } from "./pdf-poppler.js";

const require = createRequire(import.meta.url);
type LegacyPdfParse = (
  buffer: Buffer,
  options?: { max?: number; version?: string },
) => Promise<{ text?: string }>;
const legacyPdfParse = require("legacy-pdf-parse/lib/pdf-parse.js") as LegacyPdfParse;

const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(pdfjsRoot, "legacy/build/pdf.worker.mjs"),
).href;

const MIN_TEXT_LEN = 20;

const MSG_NO_TEXT =
  "No pudimos extraer suficiente texto del PDF con parsers locales.\n\n" +
  "Este PDF parece tener poco texto embebido (solo metadatos). Probá:\n" +
  "1) Pegar el texto de la factura (botón abajo), o\n" +
  "2) Configurar COMPRAS_GEMINI_API_KEY en el backend, o\n" +
  "3) Descargar de nuevo el comprobante desde AFIP/ARCA.";

const MSG_PASSWORD =
  "El PDF está protegido con contraseña.\n\n" +
  "Descargá o exportá una copia sin protección e intentá de nuevo.";

const MSG_CORRUPT =
  "No se pudo abrir el PDF.\n\n" +
  "Verificá que el archivo no esté corrupto y que sea un PDF válido.";

function pdfJsResourceUrls(): Pick<
  DocumentInitParameters,
  "standardFontDataUrl" | "cMapUrl" | "cMapPacked"
> {
  return {
    standardFontDataUrl: pathToFileURL(path.join(pdfjsRoot, "standard_fonts/")).href,
    cMapUrl: pathToFileURL(path.join(pdfjsRoot, "cmaps/")).href,
    cMapPacked: true,
  };
}

function scoreText(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.replace(/[^\p{L}\p{N}]/gu, "").length;
}

function previewText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 120);
}

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

function tableResultToText(result: {
  pages?: Array<{ tables?: Array<Array<Array<string>>> }>;
  mergedTables?: Array<Array<Array<string>>>;
}): string {
  const chunks: string[] = [];
  for (const page of result.pages ?? []) {
    for (const table of page.tables ?? []) {
      for (const row of table) {
        chunks.push(row.join(" | "));
      }
    }
  }
  for (const table of result.mergedTables ?? []) {
    for (const row of table) {
      chunks.push(row.join(" | "));
    }
  }
  return chunks.join("\n").trim();
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectStrings(item, out);
    }
  }
}

async function extractWithPdfParse(
  buffer: Buffer,
  load: LoadParameters,
  parse?: { disableNormalization?: boolean },
): Promise<string> {
  const parser = new PDFParse({ ...load, data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText(parse ?? {});
    return normalizeExtractedText(result);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractWithPdfParseTable(buffer: Buffer, load: LoadParameters): Promise<string> {
  const parser = new PDFParse({ ...load, data: new Uint8Array(buffer) });
  try {
    const result = await parser.getTable();
    return tableResultToText(result);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractWithPdfJsDirect(
  buffer: Buffer,
  load: DocumentInitParameters,
): Promise<string> {
  const loadingTask = getDocument({
    ...pdfJsResourceUrls(),
    ...load,
    data: new Uint8Array(buffer),
    isEvalSupported: false,
  });

  const doc = await loadingTask.promise;
  const chunks: string[] = [];

  try {
    if (doc.allXfaHtml) collectStrings(doc.allXfaHtml, chunks);

    const fields = await doc.getFieldObjects().catch(() => null);
    if (fields) {
      for (const [fieldName, entries] of Object.entries(fields)) {
        const values: string[] = [];
        collectStrings(entries, values);
        if (values.length > 0) chunks.push(`${fieldName}: ${values.join(" ")}`);
      }
    }

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const annotations = await page.getAnnotations({ intent: "display" }).catch(() => []);
      for (const annotation of annotations) {
        const overlaid = (annotation as { overlaidText?: string }).overlaidText;
        if (overlaid?.trim()) chunks.push(overlaid.trim());
      }

      for (const disableNormalization of [false, true] as const) {
        const textContent = await page.getTextContent({
          includeMarkedContent: true,
          disableNormalization,
        });
        const pageText = textContent.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .trim();
        if (pageText) chunks.push(pageText);
      }
      page.cleanup();
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }

  return [...new Set(chunks)].join("\n").trim();
}

async function extractWithLegacy(buffer: Buffer): Promise<string> {
  const result = await legacyPdfParse(buffer, { max: 0 });
  return (result.text ?? "").trim();
}

function isPasswordError(err: unknown): boolean {
  if (err instanceof PasswordException) return true;
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes("password") ||
    message.includes("encrypted") ||
    (typeof err === "object" &&
      err !== null &&
      "name" in err &&
      String((err as { name?: string }).name).includes("Password"))
  );
}

async function runExtractionStrategies(buffer: Buffer): Promise<{ text: string; strategy: string } | null> {
  const xfaLoad: LoadParameters = {
    enableXfa: true,
    useSystemFonts: true,
    useWorkerFetch: false,
    ...pdfJsResourceUrls(),
  };

  const strategies: Array<{ name: string; run: () => Promise<string> }> = [
    { name: "pdf-parse-default", run: () => extractWithPdfParse(buffer, {}) },
    { name: "pdf-parse-xfa-fonts", run: () => extractWithPdfParse(buffer, xfaLoad) },
    {
      name: "pdf-parse-no-normalize",
      run: () => extractWithPdfParse(buffer, xfaLoad, { disableNormalization: true }),
    },
    { name: "pdf-parse-table", run: () => extractWithPdfParseTable(buffer, xfaLoad) },
    {
      name: "pdfjs-direct",
      run: () =>
        extractWithPdfJsDirect(buffer, {
          enableXfa: true,
          useSystemFonts: true,
          useWorkerFetch: false,
        }),
    },
    { name: "legacy-pdf-parse", run: () => extractWithLegacy(buffer) },
    { name: "pdftotext-poppler", run: () => extractWithPdftotext(buffer) },
  ];

  let best: { text: string; strategy: string; score: number } | null = null;

  for (const strategy of strategies) {
    try {
      const text = await strategy.run();
      const score = scoreText(text);
      console.info(
        `[compras] PDF extract ${strategy.name}: score=${score} len=${text.length} preview="${previewText(text)}"`,
      );
      if (score >= MIN_TEXT_LEN && (!best || score > best.score)) {
        best = { text, strategy: strategy.name, score };
      }
    } catch (err) {
      if (isPasswordError(err)) throw err;
      console.warn(`[compras] PDF extract ${strategy.name} falló:`, err);
    }
  }

  return best ? { text: best.text, strategy: best.strategy } : null;
}

export async function extractPdfTextFromBuffer(buffer: Buffer): Promise<string> {
  if (buffer.length === 0) {
    throw new AppError(400, "PDF_EMPTY", MSG_CORRUPT);
  }

  if (!buffer.subarray(0, 4).toString("utf8").startsWith("%PDF")) {
    throw new AppError(400, "PDF_PARSE_ERROR", MSG_CORRUPT);
  }

  try {
    const result = await runExtractionStrategies(buffer);
    if (result) {
      console.info(`[compras] PDF extract OK via ${result.strategy}`);
      return result.text;
    }

    if (isGeminiExtractionEnabled()) {
      console.info("[compras] PDF extract probando Gemini fallback…");
      const geminiText = await extractWithGemini(buffer);
      const score = scoreText(geminiText);
      console.info(
        `[compras] PDF extract gemini: score=${score} len=${geminiText.length} preview="${previewText(geminiText)}"`,
      );
      if (score >= MIN_TEXT_LEN) return geminiText;
    }
  } catch (err) {
    if (isPasswordError(err)) {
      throw new AppError(400, "PDF_PASSWORD", MSG_PASSWORD);
    }
    if (err instanceof AppError) throw err;
    console.warn("[compras] PDF extract abortado:", err);
  }

  throw new AppError(400, "PDF_NO_TEXT", MSG_NO_TEXT);
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
