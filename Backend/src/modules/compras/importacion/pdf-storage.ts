import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { env } from "../../../config/env.js";
import { AppError } from "../../../middleware/errors.js";

const MAX_PDF_BYTES = 8 * 1024 * 1024;

export function getPdfStorageDir(): string {
  return path.resolve(env.COMPRAS_PDF_DIR);
}

export async function ensurePdfStorageDir(): Promise<void> {
  await mkdir(getPdfStorageDir(), { recursive: true });
}

export function validatePdfUpload(meta: {
  filename: string;
  mimetype: string;
  size: number;
}): void {
  const name = meta.filename.toLowerCase();
  if (!name.endsWith(".pdf")) {
    throw new AppError(400, "INVALID_FILE", "Solo se aceptan archivos .pdf");
  }
  const mime = meta.mimetype.toLowerCase();
  if (mime && mime !== "application/pdf" && mime !== "application/x-pdf") {
    throw new AppError(400, "INVALID_MIME", `MIME no permitido: ${meta.mimetype}`);
  }
  if (meta.size <= 0) {
    throw new AppError(400, "EMPTY_FILE", "El archivo está vacío o corrupto");
  }
  if (meta.size > MAX_PDF_BYTES) {
    throw new AppError(400, "FILE_TOO_LARGE", "El PDF supera el máximo de 8 MB");
  }
}

export function assertPdfMagicBytes(buffer: Buffer): void {
  // %PDF-
  if (
    buffer.length < 5 ||
    buffer[0] !== 0x25 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x44 ||
    buffer[3] !== 0x46 ||
    buffer[4] !== 0x2d
  ) {
    throw new AppError(400, "INVALID_PDF", "El archivo no es un PDF válido");
  }
}

export async function storePdfBuffer(
  buffer: Buffer,
  importId: number,
): Promise<{ storageKey: string; absolutePath: string }> {
  assertPdfMagicBytes(buffer);
  await ensurePdfStorageDir();
  const storageKey = `${importId}-${randomUUID()}.pdf`;
  const absolutePath = path.join(getPdfStorageDir(), storageKey);
  await writeFile(absolutePath, buffer);
  return { storageKey, absolutePath };
}

export function resolvePdfPath(storageKey: string): string {
  const base = getPdfStorageDir();
  const resolved = path.resolve(base, storageKey);
  if (!resolved.startsWith(base)) {
    throw new AppError(400, "INVALID_STORAGE_KEY", "Ruta de PDF inválida");
  }
  return resolved;
}
