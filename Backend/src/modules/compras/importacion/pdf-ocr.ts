import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));

function pdfJsResourceUrls() {
  return {
    standardFontDataUrl: pathToFileURL(path.join(pdfjsRoot, "standard_fonts/")).href,
    cMapUrl: pathToFileURL(path.join(pdfjsRoot, "cmaps/")).href,
    cMapPacked: true,
  };
}

const OCR_RENDER_SCALE = 2;

/**
 * OCR fallback for image-only PDFs (print-to-PDF / scanned invoices).
 * Renders each page with pdf.js + @napi-rs/canvas, then runs Tesseract (spa).
 */
export async function extractWithOcr(buffer: Buffer): Promise<string> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const { createWorker } = await import("tesseract.js");

  const loadingTask = getDocument({
    ...pdfJsResourceUrls(),
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useWorkerFetch: false,
  });

  const doc = await loadingTask.promise;
  const worker = await createWorker("spa");
  const parts: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
      const canvas = createCanvas(viewport.width, viewport.height);
      const canvasContext = canvas.getContext("2d");

      await page.render({
        canvasContext: canvasContext as unknown as CanvasRenderingContext2D,
        viewport,
        canvas: canvas as unknown as HTMLCanvasElement,
      }).promise;

      const { data } = await worker.recognize(canvas.toBuffer("image/png"));
      if (data.text?.trim()) parts.push(data.text.trim());
      page.cleanup();
    }
  } finally {
    await worker.terminate().catch(() => undefined);
    await doc.destroy().catch(() => undefined);
  }

  return parts.join("\n\n").trim();
}
