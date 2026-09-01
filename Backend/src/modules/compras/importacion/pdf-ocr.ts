import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PSM_MODES = ["4", "11", "6"] as const;

function scoreOcrText(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  let score = trimmed.replace(/[^\p{L}\p{N}]/gu, "").length;
  if (/^COD$/im.test(trimmed) && /^CANT$/im.test(trimmed) && /DETALL/i.test(trimmed)) {
    score += 500;
  }
  if (/EC\d{2}|E\d{3}/i.test(trimmed)) score += 200;
  if (/SOLD\./i.test(trimmed)) score += 200;
  return score;
}

async function runTesseract(imagePath: string, psm: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "tesseract",
    [imagePath, "stdout", "-l", "spa", "--psm", psm],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  return stdout.trim();
}

/**
 * OCR fallback for image-only PDFs (print-to-PDF / scanned invoices).
 * Uses poppler + tesseract CLI so native crashes stay out of the Node process.
 */
export async function extractWithOcr(buffer: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "compras-ocr-"));
  const pdfPath = path.join(dir, "input.pdf");
  const imagePrefix = path.join(dir, "page");

  try {
    await writeFile(pdfPath, buffer);

    await execFileAsync("pdftoppm", ["-png", "-r", "300", pdfPath, imagePrefix], {
      maxBuffer: 10 * 1024 * 1024,
    });

    const images = (await readdir(dir))
      .filter((name) => name.startsWith("page") && name.endsWith(".png"))
      .sort();

    if (images.length === 0) {
      throw new Error("pdftoppm no generó imágenes");
    }

    const pageTexts: string[] = [];
    for (const image of images) {
      const imagePath = path.join(dir, image);
      let bestText = "";
      let bestScore = 0;

      for (const psm of PSM_MODES) {
        try {
          const text = await runTesseract(imagePath, psm);
          const score = scoreOcrText(text);
          if (score > bestScore) {
            bestScore = score;
            bestText = text;
          }
        } catch {
          // try next PSM
        }
      }

      if (bestText) pageTexts.push(bestText);
    }

    return pageTexts.join("\n\n").trim();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
