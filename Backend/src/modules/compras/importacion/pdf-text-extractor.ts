import { readFile } from "fs/promises";
import { PDFParse } from "pdf-parse";
import { AppError } from "../../../middleware/errors.js";

/**
 * Adapter de extracción de texto. Intercambiable por OCR/IA más adelante.
 * Contrato: path → string de texto plano.
 */
export async function extractPdfText(absolutePath: string): Promise<string> {
  let buffer: Buffer;
  try {
    buffer = await readFile(absolutePath);
  } catch {
    throw new AppError(400, "PDF_READ_ERROR", "No se pudo leer el archivo PDF del disco");
  }

  if (buffer.length === 0) {
    throw new AppError(
      400,
      "PDF_EMPTY",
      "No se pudo leer el PDF.\n\nEl archivo puede estar:\n- corrupto\n- protegido\n- escaneado como imagen\n- en un formato no compatible",
    );
  }

  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const text = (result.text ?? "").trim();
    if (text.length < 20) {
      throw new AppError(
        400,
        "PDF_NO_TEXT",
        "No se pudo leer el PDF.\n\nEl archivo puede estar:\n- corrupto\n- protegido\n- escaneado como imagen\n- en un formato no compatible",
      );
    }
    return text;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      400,
      "PDF_PARSE_ERROR",
      "No se pudo leer el PDF.\n\nEl archivo puede estar:\n- corrupto\n- protegido\n- escaneado como imagen\n- en un formato no compatible",
    );
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
