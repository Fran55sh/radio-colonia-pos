import type { DbClient } from "../../../config/db.js";
import { withTransaction } from "../../../config/db.js";
import { lockAndIncrementForPurchase } from "../../../lib/catalog.js";
import { AppError } from "../../../middleware/errors.js";
import { applyComputedAmountsToInvoice, computeInvoiceAmounts } from "./invoice-math.js";
import {
  assertSupplierCodeMapping,
  findOrCreateProveedorOnExecute,
} from "./product-matcher.js";
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
  const code = codigoProveedor || "SIN-CODIGO";
  const cost = costo.toFixed(2);

  // Si el código estaba en otra variante, reasignarlo (tras confirmación previa)
  await client.query(
    `DELETE FROM product_supplier_offers
     WHERE supplier_id = $1
       AND lower(supplier_code) = lower($2)
       AND variant_id <> $3`,
    [proveedorId, code, variantId],
  );

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
    [variantId, proveedorId, code, cost],
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
  proveedor_creado: boolean;
}> {
  return withTransaction(async (client: DbClient) => {
    const locked = await client.query<{
      id: number;
      estado: string;
      review_json: NormalizedInvoice;
      pdf_storage_key: string | null;
      proveedor_id: string | null;
      origen: string;
    }>(
      `SELECT id, estado, review_json, pdf_storage_key, proveedor_id, origen
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

    // Fuente de verdad: recalcular importes en servidor
    const invoice = applyComputedAmountsToInvoice(row.review_json);
    const issues = validateReviewInvoice(invoice);
    if (hasCriticalErrors(issues)) {
      throw new AppError(400, "VALIDATION_FAILED", "Hay errores que impiden ejecutar", {
        issues,
      });
    }

    const proveedor = await findOrCreateProveedorOnExecute(
      client,
      invoice.proveedor.cuit,
      invoice.proveedor.razon_social,
      invoice.proveedor.proveedor_id ?? row.proveedor_id,
    );
    const proveedorId = proveedor.id;
    invoice.proveedor.proveedor_id = proveedorId;
    invoice.proveedor.razon_social = proveedor.name;
    invoice.proveedor.se_creara = false;

    const tipo = (invoice.factura.tipo ?? "A").toUpperCase();
    const puntoVenta = pad(invoice.factura.punto_venta ?? "0", 4);
    const numero = pad(invoice.factura.numero ?? "0", 8);
    const fecha = invoice.factura.fecha!;
    const label = numeroComprobanteLabel(invoice);
    const origenOc =
      row.origen === "manual" ? "factura_manual" : "factura_pdf";

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
      throw new AppError(409, "FACTURA_DUPLICADA", "Esta factura ya fue procesada.");
    }

    for (const item of invoice.items) {
      await assertSupplierCodeMapping(
        client,
        proveedorId,
        item.codigo_proveedor?.trim() || "",
        item.variant_id!,
        Boolean(item.confirmar_cambio_mapeo),
      );
    }

    const { lines, totals } = computeInvoiceAmounts(
      invoice.items,
      invoice.totales.descuento_total,
    );

    const orden = await client.query<{ id: number }>(
      `INSERT INTO pos_ordenes_compra (
         proveedor_id, estado, observaciones, origen, recibido_at, recibido_por
       ) VALUES ($1, 'recibida', $2, $3, NOW(), $4)
       RETURNING id`,
      [
        proveedorId,
        `Importación #${importacionId} · ${label}`,
        origenOc,
        executedBy,
      ],
    );
    const ordenId = orden.rows[0].id;

    for (let i = 0; i < invoice.items.length; i += 1) {
      const item = invoice.items[i]!;
      const calc = lines[i]!;
      const variantId = item.variant_id!;
      const codigoProv = item.codigo_proveedor?.trim() || item.sku || "SIN-CODIGO";
      const sku = (item.sku ?? "").toLowerCase() || codigoProv.toLowerCase();
      const descripcion =
        item.producto_nombre?.trim() || item.descripcion?.trim() || sku;

      await client.query(
        `INSERT INTO pos_ordenes_compra_lineas (
           orden_id, variant_id, sku_snapshot, codigo_proveedor, cantidad, costo_unitario,
           descuento, descuento_porcentaje, importe, descripcion_factura,
           alicuota_iva, neto_linea, iva_linea, total_linea
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          ordenId,
          variantId,
          sku,
          codigoProv,
          Math.round(item.cantidad),
          item.precio_unitario,
          calc.descuento_monto,
          calc.descuento_porcentaje,
          calc.importe,
          descripcion,
          calc.alicuota_iva,
          calc.neto_linea,
          calc.iva_linea,
          calc.total_linea,
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

    const pdfKey =
      row.pdf_storage_key &&
      row.pdf_storage_key !== "pending" &&
      row.pdf_storage_key !== "manual" &&
      row.pdf_storage_key !== "text-only"
        ? row.pdf_storage_key
        : null;

    const factura = await client.query<{ id: number }>(
      `INSERT INTO pos_facturas_compra (
         proveedor_id, numero_comprobante, fecha_fiscal,
         neto_gravado, iva_total, exento, total, descuento_total,
         tipo_comprobante, punto_venta, numero, orden_id, pdf_storage_key
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        proveedorId,
        label,
        fecha,
        totals.subtotal - totals.exento,
        totals.iva,
        totals.exento,
        totals.total,
        totals.descuento_total,
        tipo,
        puntoVenta,
        numero,
        ordenId,
        pdfKey,
      ],
    );
    const facturaId = factura.rows[0].id;

    for (const bucket of totals.by_alicuota) {
      await client.query(
        `INSERT INTO pos_iva_registro (
           tipo, referencia_tipo, referencia_id, fecha_fiscal,
           alicuota, neto_gravado, iva, exento, total, comprobante
         ) VALUES ('compra', 'pos_factura_compra', $1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          facturaId,
          fecha,
          bucket.alicuota,
          bucket.neto_gravado,
          bucket.iva,
          bucket.exento,
          bucket.total,
          label,
        ],
      );
    }

    await client.query(
      `UPDATE pos_compras_importaciones
       SET estado = 'ejecutado',
           proveedor_id = $2,
           orden_id = $3,
           factura_id = $4,
           review_json = $5::jsonb,
           executed_at = NOW(),
           executed_by = $6,
           updated_at = NOW(),
           warnings = $7::jsonb
       WHERE id = $1`,
      [
        importacionId,
        proveedorId,
        ordenId,
        facturaId,
        JSON.stringify(invoice),
        executedBy,
        JSON.stringify(issues.filter((i) => i.level === "warning")),
      ],
    );

    return {
      importacion_id: importacionId,
      orden_id: ordenId,
      factura_id: facturaId,
      items_procesados: invoice.items.length,
      proveedor_creado: proveedor.created,
    };
  });
}
