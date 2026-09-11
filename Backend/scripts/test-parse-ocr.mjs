/**
 * Test parseInvoiceText on OCR output from failing PDF
 */
import { readFile } from "fs/promises";
import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker } from "tesseract.js";
import { parseInvoiceText } from "../src/modules/compras/importacion/invoice-parser.js";

const require = createRequire(import.meta.url);
const pdfPath = process.argv[2];
const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(pdfjsRoot, "legacy/build/pdf.worker.mjs"),
).href;

async function ocrPdf(buffer) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const loadingTask = getDocument({
    standardFontDataUrl: pathToFileURL(path.join(pdfjsRoot, "standard_fonts/")).href,
    cMapUrl: pathToFileURL(path.join(pdfjsRoot, "cmaps/")).href,
    cMapPacked: true,
    data: new Uint8Array(buffer),
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  const worker = await createWorker("spa");
  const parts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const { data } = await worker.recognize(canvas.toBuffer("image/png"));
    parts.push(data.text);
    page.cleanup();
  }
  await worker.terminate();
  await doc.destroy();
  return parts.join("\n\n").trim();
}

const buffer = await readFile(pdfPath);
const text = await ocrPdf(buffer);
console.log("OCR text length:", text.length);
const parsed = parseInvoiceText(text);
console.log(JSON.stringify(parsed, null, 2));
