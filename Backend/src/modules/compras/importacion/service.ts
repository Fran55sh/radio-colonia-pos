import { pool, withTransaction } from "../../../config/db.js";
import type { DbClient } from "../../../config/db.js";
import { AppError } from "../../../middleware/errors.js";
import { executeImportacion } from "./execute.js";
import { parseInvoiceText } from "./invoice-parser.js";
import { extractPdfTextFromBuffer } from "./pdf-text-extractor.js";
import {
  resolvePdfPath,
  storePdfBuffer,
  validatePdfUpload,
} from "./pdf-storage.js";
import { matchInvoiceProducts } from "./product-matcher.js";
import {
  normalizedInvoiceSchema,
  type NormalizedInvoice,
} from "./schemas.js";
import {
  computeMatchStats,
  hasCriticalErrors,
  validateReviewInvoice,
} from "./validation.js";

function mapImportRow(row: Record<string, unknown>) {
  const review = row.review_json as NormalizedInvoice;
  const stats = computeMatchStats(review);
  const issues = validateReviewInvoice(review);
  return {
    id: row.id,
    estado: row.estado,
    proveedor_id: row.proveedor_id,
    pdf_original_name: row.pdf_original_name,
    pdf_size: row.pdf_size,
    extracted_json: row.extracted_json,
    review_json: review,
    warnings: row.warnings,
    error_message: row.error_message,
    orden_id: row.orden_id,
    factura_id: row.factura_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    executed_at: row.executed_at,
    executed_by: row.executed_by,
    stats,
    validation: {
      can_execute: !hasCriticalErrors(issues) && row.estado !== "ejecutado" && row.estado !== "cancelado",
      issues,
    },
  };
}

export async function createImportacionFromPdf(file: {
  filename: string;
  mimetype: string;
  buffer: Buffer;
}) {
  validatePdfUpload({
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.buffer.length,
  });

  // Placeholder row to get id for storage key
  const placeholder = await pool.query<{ id: number }>(
    `INSERT INTO pos_compras_importaciones (
       estado, pdf_storage_key, pdf_original_name, pdf_mime, pdf_size
     ) VALUES ('borrador', 'pending', $1, $2, $3)
     RETURNING id`,
    [file.filename, file.mimetype || "application/pdf", file.buffer.length],
  );
  const importId = placeholder.rows[0].id;

  try {
    const { storageKey } = await storePdfBuffer(file.buffer, importId);
    await pool.query(
      `UPDATE pos_compras_importaciones SET pdf_storage_key = $2, updated_at = NOW() WHERE id = $1`,
      [importId, storageKey],
    );

    const text = await extractPdfTextFromBuffer(file.buffer);
    const extracted = parseInvoiceText(text);

    const matched = await withTransaction(async (client: DbClient) => {
      return matchInvoiceProducts(client, extracted);
    });

    const issues = validateReviewInvoice(matched);
    const estado = hasCriticalErrors(issues) ? "borrador" : "listo";

    const { rows } = await pool.query(
      `UPDATE pos_compras_importaciones
       SET extracted_json = $2::jsonb,
           review_json = $3::jsonb,
           proveedor_id = $4,
           warnings = $5::jsonb,
           estado = $6,
           error_message = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        importId,
        JSON.stringify(extracted),
        JSON.stringify(matched),
        matched.proveedor.proveedor_id,
        JSON.stringify(issues),
        estado,
      ],
    );

    return mapImportRow(rows[0]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al procesar PDF";
    await pool.query(
      `UPDATE pos_compras_importaciones
       SET error_message = $2, updated_at = NOW()
       WHERE id = $1`,
      [importId, message],
    );
    throw err;
  }
}

export async function getImportacion(id: number) {
  const { rows } = await pool.query(
    `SELECT * FROM pos_compras_importaciones WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  return mapImportRow(rows[0]);
}

export async function listImportaciones(limit = 50) {
  const { rows } = await pool.query(
    `SELECT i.*, s.name AS proveedor_nombre
     FROM pos_compras_importaciones i
     LEFT JOIN suppliers s ON s.id = i.proveedor_id
     ORDER BY i.created_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    ...mapImportRow(r),
    proveedor_nombre: r.proveedor_nombre,
  }));
}

export async function updateImportacionReview(
  id: number,
  review: NormalizedInvoice,
) {
  const parsed = normalizedInvoiceSchema.parse(review);
  const current = await getImportacion(id);
  if (!current) throw new AppError(404, "NOT_FOUND", "Importación no encontrada");
  if (current.estado === "ejecutado" || current.estado === "cancelado") {
    throw new AppError(409, "IMMUTABLE", "No se puede editar una importación cerrada");
  }

  const issues = validateReviewInvoice(parsed);
  const estado = hasCriticalErrors(issues) ? "borrador" : "listo";

  const { rows } = await pool.query(
    `UPDATE pos_compras_importaciones
     SET review_json = $2::jsonb,
         proveedor_id = $3,
         warnings = $4::jsonb,
         estado = $5,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      JSON.stringify(parsed),
      parsed.proveedor.proveedor_id,
      JSON.stringify(issues),
      estado,
    ],
  );
  return mapImportRow(rows[0]);
}

export async function cancelImportacion(id: number) {
  const { rows } = await pool.query(
    `UPDATE pos_compras_importaciones
     SET estado = 'cancelado', updated_at = NOW()
     WHERE id = $1 AND estado IN ('borrador', 'listo')
     RETURNING *`,
    [id],
  );
  if (rows.length === 0) {
    throw new AppError(409, "CANNOT_CANCEL", "No se puede cancelar esta importación");
  }
  return mapImportRow(rows[0]);
}

export { executeImportacion, resolvePdfPath };
