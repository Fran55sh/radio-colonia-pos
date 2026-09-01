import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

    await execFileAsync("pdftoppm", ["-png", "-r", "200", pdfPath, imagePrefix], {
      maxBuffer: 10 * 1024 * 1024,
    });

    const images = (await readdir(dir))
      .filter((name) => name.startsWith("page") && name.endsWith(".png"))
      .sort();

    if (images.length === 0) {
      throw new Error("pdftoppm no generó imágenes");
    }

    const parts: string[] = [];
    for (const image of images) {
      const imagePath = path.join(dir, image);
      const { stdout } = await execFileAsync(
        "tesseract",
        [imagePath, "stdout", "-l", "spa", "--psm", "6"],
        { maxBuffer: 10 * 1024 * 1024 },
      );
      if (stdout.trim()) parts.push(stdout.trim());
    }

    return parts.join("\n\n").trim();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
