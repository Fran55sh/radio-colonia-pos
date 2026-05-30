import type { DbClient } from "../../config/db.js";
import { withTransaction } from "../../config/db.js";
import {
  decrementVariantStock,
  getVariantForSale,
  listCatalogForPos,
  type ProductoCaja,
} from "../../lib/catalog.js";
import { DEFAULT_IVA_ALICUOTA } from "../../lib/constants.js";
import { splitPriceWithIva } from "../../lib/iva.js";
import { AppError } from "../../middleware/errors.js";
import type { CreateSaleInput } from "./schemas.js";

export type { ProductoCaja };

export async function listProductosCaja(client: DbClient): Promise<ProductoCaja[]> {
  return listCatalogForPos(client);
}

export async function processSale(
  input: CreateSaleInput,
): Promise<{ venta_id: number; total: number; client_sale_id?: string }> {
  return withTransaction(async (client) => {
    if (input.client_sale_id) {
      const dup = await client.query(
        `SELECT id FROM pos_ventas WHERE client_sale_id = $1`,
        [input.client_sale_id],
      );
      if (dup.rows.length > 0) {
        throw new AppError(409, "DUPLICATE_OFFLINE_SALE", "Venta ya registrada", {
          venta_id: dup.rows[0].id,
        });
      }
    }

    let netoTotal = 0;
    let ivaTotal = 0;
    let exentoTotal = 0;
    let totalVenta = 0;

    const lineasDetalle: Array<{
      variant_id: string;
      sku_snapshot: string;
      name_snapshot: string;
      cantidad: number;
      precio_unitario: number;
      cost_price_snapshot: number | null;
      supplier_id_snapshot: string | null;
      supplier_code_snapshot: string | null;
      alicuota_iva: number;
      neto_linea: number;
      iva_linea: number;
      exento_linea: number;
      total_linea: number;
    }> = [];

    for (const linea of input.lineas) {
      const codigo = linea.codigo_interno.trim().toLowerCase();
      const variant = await getVariantForSale(client, codigo);

      const precio = variant.precio_venta;
      const alicuota = DEFAULT_IVA_ALICUOTA;
      const totalLinea = precio * linea.cantidad;
      const breakdown = splitPriceWithIva(totalLinea, alicuota);

      await decrementVariantStock(client, codigo, linea.cantidad);

      lineasDetalle.push({
        variant_id: variant.variant_id,
        sku_snapshot: variant.sku,
        name_snapshot: variant.nombre,
        cantidad: linea.cantidad,
        precio_unitario: precio,
        cost_price_snapshot: variant.cost_price,
        supplier_id_snapshot: variant.supplier_id,
        supplier_code_snapshot: variant.supplier_code,
        alicuota_iva: alicuota,
        neto_linea: breakdown.netoGravado,
        iva_linea: breakdown.iva,
        exento_linea: breakdown.exento,
        total_linea: breakdown.total,
      });

      netoTotal += breakdown.netoGravado;
      ivaTotal += breakdown.iva;
      exentoTotal += breakdown.exento;
      totalVenta += breakdown.total;
    }

    const ventaInsert = await client.query<{ id: number }>(
      `INSERT INTO pos_ventas (
        client_sale_id, cliente_id, canal, medio_pago, estado,
        neto_gravado, iva_total, exento, total, sincronizada_offline
      ) VALUES ($1, $2, 'pos', $3, 'completada', $4, $5, $6, $7, $8)
      RETURNING id`,
      [
        input.client_sale_id ?? null,
        input.cliente_id ?? null,
        input.medio_pago,
        netoTotal,
        ivaTotal,
        exentoTotal,
        totalVenta,
        input.sincronizada_offline ?? false,
      ],
    );
    const ventaId = ventaInsert.rows[0].id;

    for (const ld of lineasDetalle) {
      await client.query(
        `INSERT INTO pos_lineas_venta (
          venta_id, variant_id, sku_snapshot, name_snapshot, cantidad, precio_unitario,
          cost_price_snapshot, supplier_id_snapshot, supplier_code_snapshot, alicuota_iva,
          neto_linea, iva_linea, exento_linea, total_linea
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          ventaId,
          ld.variant_id,
          ld.sku_snapshot,
          ld.name_snapshot,
          ld.cantidad,
          ld.precio_unitario,
          ld.cost_price_snapshot,
          ld.supplier_id_snapshot,
          ld.supplier_code_snapshot,
          ld.alicuota_iva,
          ld.neto_linea,
          ld.iva_linea,
          ld.exento_linea,
          ld.total_linea,
        ],
      );
    }

    await client.query(
      `INSERT INTO pos_iva_registro (
        tipo, referencia_tipo, referencia_id, fecha_fiscal,
        alicuota, neto_gravado, iva, exento, total
      ) VALUES ('venta', 'pos_venta', $1, CURRENT_DATE, $2, $3, $4, $5, $6)`,
      [ventaId, DEFAULT_IVA_ALICUOTA, netoTotal, ivaTotal, exentoTotal, totalVenta],
    );

    return {
      venta_id: ventaId,
      total: totalVenta,
      client_sale_id: input.client_sale_id,
    };
  });
}

export async function processOfflineBatch(
  ventas: CreateSaleInput[],
): Promise<{
  procesadas: number;
  duplicadas: number;
  errores: Array<{ client_sale_id: string; error: string }>;
  resultados: Array<{ client_sale_id: string; venta_id: number; total: number }>;
}> {
  const resultados: Array<{ client_sale_id: string; venta_id: number; total: number }> = [];
  const errores: Array<{ client_sale_id: string; error: string }> = [];
  let duplicadas = 0;
  let procesadas = 0;

  for (const venta of ventas) {
    try {
      const result = await processSale({
        ...venta,
        sincronizada_offline: true,
      });
      procesadas++;
      if (venta.client_sale_id) {
        resultados.push({
          client_sale_id: venta.client_sale_id,
          venta_id: result.venta_id,
          total: result.total,
        });
      }
    } catch (err) {
      if (err instanceof AppError && err.code === "DUPLICATE_OFFLINE_SALE") {
        duplicadas++;
        if (venta.client_sale_id) {
          resultados.push({
            client_sale_id: venta.client_sale_id,
            venta_id: (err.details as { venta_id: number }).venta_id,
            total: 0,
          });
        }
        continue;
      }
      errores.push({
        client_sale_id: venta.client_sale_id ?? "unknown",
        error: err instanceof Error ? err.message : "Error desconocido",
      });
    }
  }

  return { procesadas, duplicadas, errores, resultados };
}
