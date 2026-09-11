/**
 * Test OCR on image-only PDF via pdfjs + @napi-rs/canvas + tesseract.js
 */
import { readFile, writeFile } from "fs/promises";
import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
const pdfPath = process.argv[2];

const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(pdfjsRoot, "legacy/build/pdf.worker.mjs"),
).href;

async function renderPageToPng(buffer) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const loadingTask = getDocument({
    standardFontDataUrl: pathToFileURL(path.join(pdfjsRoot, "standard_fonts/")).href,
    cMapUrl: pathToFileURL(path.join(pdfjsRoot, "cmaps/")).href,
    cMapPacked: true,
    data: new Uint8Array(buffer),
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 2.0 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const png = canvas.toBuffer("image/png");
  await doc.destroy();
  return png;
}

async function main() {
  const buffer = await readFile(pdfPath);
  console.log("Rendering page...");
  const png = await renderPageToPng(buffer);
  await writeFile("test-page.png", png);
  console.log("Saved test-page.png, size:", png.length);

  console.log("Running tesseract.js...");
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("spa");
  const { data } = await worker.recognize(png);
  await worker.terminate();
  console.log("OCR confidence:", data.confidence);
  console.log("OCR text length:", data.text.length);
  console.log("OCR preview:\n", data.text.slice(0, 2000));
}

main().catch(console.error);
