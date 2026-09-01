import type { DbClient } from "../../../config/db.js";
import { withTransaction } from "../../../config/db.js";
import { lockAndIncrementForPurchase } from "../../../lib/catalog.js";
import { DEFAULT_IVA_ALICUOTA } from "../../../lib/constants.js";
import { AppError } from "../../../middleware/errors.js";
import type { NormalizedInvoice } from "./schemas.js";
import { hasCriticalErrors, validateReviewInvoice } from "./validation.js";

function pad(value: string, len: number): string {
  return value.replace(/\D/g, "").padStart(len, "0").slice(-len);
}

function numeroComprobanteLabel(inv: NormalizedInvoice): string {
  const tipo = (inv.factura.tipo ?? "A").toUpperCase();
  const pv = pad(inv.factura.punto_venta ?? "0", 4);
  const nro = pad(inv.factura.numero ?? "0", 8);
  return `${tipo}-${pv}-${nro}`;
}

async function upsertSupplierOffer(
  client: DbClient,
  proveedorId: string,
  variantId: string,
  codigoProveedor: string,
  costo: number,
) {
  await client.query(
    `INSERT INTO product_supplier_offers (
       variant_id, supplier_id, supplier_code, cost_price, stock, is_preferred, last_cost_update
     ) VALUES ($1, $2, $3, $4, 0, TRUE, NOW())
     ON CONFLICT (variant_id, supplier_id) DO UPDATE SET
       supplier_code = EXCLUDED.supplier_code,
       cost_price = EXCLUDED.cost_price,
       is_preferred = TRUE,
       last_cost_update = NOW(),
       updated_at = NOW()`,
    [variantId, proveedorId, codigoProveedor || "SIN-CODIGO", costo.toFixed(2)],
  );
}

export async function executeImportacion(
  importacionId: number,
  executedBy = "pos",
): Promise<{
  importacion_id: number;
  orden_id: number;
  factura_id: number;
  items_procesados: number;
}> {
  return withTransaction(async (client: DbClient) => {
    const locked = await client.query<{
      id: number;
      estado: string;
      review_json: NormalizedInvoice;
      pdf_storage_key: string;
      proveedor_id: string | null;
    }>(
      `SELECT id, estado, review_json, pdf_storage_key, proveedor_id
       FROM pos_compras_importaciones
       WHERE id = $1
       FOR UPDATE`,
      [importacionId],
    );
    if (locked.rows.length === 0) {
      throw new AppError(404, "NOT_FOUND", "Importación no encontrada");
    }
    const row = locked.rows[0];
    if (row.estado === "ejecutado") {
      throw new AppError(409, "ALREADY_EXECUTED", "Esta importación ya fue ejecutada");
    }
    if (row.estado === "cancelado") {
      throw new AppError(409, "CANCELLED", "La importación está cancelada");
    }

    const invoice = row.review_json;
    const issues = validateReviewInvoice(invoice);
    if (hasCriticalErrors(issues)) {
      throw new AppError(400, "VALIDATION_FAILED", "Hay errores que impiden ejecutar", {
        issues,
      });
    }

    const proveedorId = invoice.proveedor.proveedor_id!;
    const tipo = (invoice.factura.tipo ?? "A").toUpperCase();
    const puntoVenta = pad(invoice.factura.punto_venta ?? "0", 4);
    const numero = pad(invoice.factura.numero ?? "0", 8);
    const fecha = invoice.factura.fecha!;
    const label = numeroComprobanteLabel(invoice);

    const dup = await client.query(
      `SELECT id FROM pos_facturas_compra
       WHERE proveedor_id = $1
         AND tipo_comprobante = $2
         AND punto_venta = $3
         AND numero = $4
       LIMIT 1`,
      [proveedorId, tipo, puntoVenta, numero],
    );
    if (dup.rows.length > 0) {
      throw new AppError(
        409,
        "FACTURA_DUPLICADA",
        "Esta factura ya fue procesada.",
      );
    }

    const orden = await client.query<{ id: number }>(
      `INSERT INTO pos_ordenes_compra (
         proveedor_id, estado, observaciones, origen, recibido_at, recibido_por
       ) VALUES ($1, 'recibida', $2, 'factura_pdf', NOW(), $3)
       RETURNING id`,
      [
        proveedorId,
        `Importación PDF #${importacionId} · ${label}`,
        executedBy,
      ],
    );
    const ordenId = orden.rows[0].id;

    for (const item of invoice.items) {
      const variantId = item.variant_id!;
      const codigoProv = item.codigo_proveedor?.trim() || item.sku || "SIN-CODIGO";
      const sku = (item.sku ?? "").toLowerCase() || codigoProv.toLowerCase();
      const importe =
        item.importe || item.cantidad * item.precio_unitario - (item.descuento || 0);

      await client.query(
        `INSERT INTO pos_ordenes_compra_lineas (
           orden_id, variant_id, sku_snapshot, codigo_proveedor, cantidad, costo_unitario,
           descuento, importe, descripcion_factura
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          ordenId,
          variantId,
          sku,
          codigoProv,
          Math.round(item.cantidad),
          item.precio_unitario,
          item.descuento || 0,
          importe,
          item.descripcion,
        ],
      );

      await lockAndIncrementForPurchase(
        client,
        variantId,
        Math.round(item.cantidad),
        item.precio_unitario,
      );

      await upsertSupplierOffer(
        client,
        proveedorId,
        variantId,
        codigoProv,
        item.precio_unitario,
      );
    }

    const neto = invoice.totales.subtotal ?? invoice.items.reduce((s, i) => s + i.importe, 0);
    const iva = invoice.totales.iva ?? 0;
    const total = invoice.totales.total ?? neto + iva;

    const factura = await client.query<{ id: number }>(
      `INSERT INTO pos_facturas_compra (
         proveedor_id, numero_comprobante, fecha_fiscal,
         neto_gravado, iva_total, exento, total,
         tipo_comprobante, punto_venta, numero, orden_id, pdf_storage_key
       ) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        proveedorId,
        label,
        fecha,
        neto,
        iva,
        total,
        tipo,
        puntoVenta,
        numero,
        ordenId,
        row.pdf_storage_key,
      ],
    );
    const facturaId = factura.rows[0].id;

    await client.query(
      `INSERT INTO pos_iva_registro (
         tipo, referencia_tipo, referencia_id, fecha_fiscal,
         alicuota, neto_gravado, iva, exento, total, comprobante
       ) VALUES ('compra', 'pos_factura_compra', $1, $2, $3, $4, $5, 0, $6, $7)`,
      [facturaId, fecha, DEFAULT_IVA_ALICUOTA, neto, iva, total, label],
    );

    await client.query(
      `UPDATE pos_compras_importaciones
       SET estado = 'ejecutado',
           proveedor_id = $2,
           orden_id = $3,
           factura_id = $4,
           executed_at = NOW(),
           executed_by = $5,
           updated_at = NOW(),
           warnings = $6::jsonb
       WHERE id = $1`,
      [
        importacionId,
        proveedorId,
        ordenId,
        facturaId,
        executedBy,
        JSON.stringify(issues.filter((i) => i.level === "warning")),
      ],
    );

    return {
      importacion_id: importacionId,
      orden_id: ordenId,
      factura_id: facturaId,
      items_procesados: invoice.items.length,
    };
  });
}
