import type { DbClient } from "../../config/db.js";
import { pool, withTransaction } from "../../config/db.js";
import { getVariantIdBySku } from "../../lib/catalog.js";
import { slugify } from "../../lib/slugify.js";
import { AppError } from "../../middleware/errors.js";
import type { createOrdenCompraSchema } from "./schemas.js";
import type { z } from "zod";

type CreateOrdenInput = z.infer<typeof createOrdenCompraSchema>;

export async function listProveedores() {
  const { rows } = await pool.query(
    `SELECT id, name AS razon_social, slug, email, phone AS telefono, notes AS notas, is_active AS activo
     FROM suppliers
     WHERE is_active = TRUE
     ORDER BY name`,
  );
  return rows;
}

export async function createProveedor(data: {
  razon_social: string;
  slug?: string;
  cuit?: string;
  email?: string;
  telefono?: string;
}) {
  const baseSlug = data.slug ?? slugify(data.razon_social);
  const notes = data.cuit ? `CUIT: ${data.cuit}` : null;
  const { rows } = await pool.query(
    `INSERT INTO suppliers (name, slug, email, phone, notes, is_active)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     RETURNING id, name AS razon_social, slug, email, phone AS telefono, is_active AS activo`,
    [data.razon_social, baseSlug, data.email || null, data.telefono ?? null, notes],
  );
  return rows[0];
}

export async function mapProductoProveedor(data: {
  proveedor_id: string;
  codigo_interno: string;
  codigo_proveedor: string;
  costo_proveedor: number;
  es_preferido?: boolean;
}) {
  const sku = data.codigo_interno.trim().toLowerCase();

  return withTransaction(async (client: DbClient) => {
    const variant = await getVariantIdBySku(client, sku);
    if (!variant) {
      throw new AppError(404, "VARIANT_NOT_FOUND", `SKU no encontrado en catálogo ecommerce: ${sku}`);
    }

    if (data.es_preferido) {
      await client.query(
        `UPDATE product_supplier_offers SET is_preferred = FALSE, updated_at = NOW()
         WHERE variant_id = $1`,
        [variant.variant_id],
      );
    }

    const { rows } = await client.query(
      `INSERT INTO product_supplier_offers (
         variant_id, supplier_id, supplier_code, cost_price, stock, is_preferred, last_cost_update
       ) VALUES ($1, $2, $3, $4, 0, $5, NOW())
       ON CONFLICT (variant_id, supplier_id) DO UPDATE SET
         supplier_code = EXCLUDED.supplier_code,
         cost_price = EXCLUDED.cost_price,
         is_preferred = EXCLUDED.is_preferred,
         last_cost_update = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [
        variant.variant_id,
        data.proveedor_id,
        data.codigo_proveedor.trim(),
        data.costo_proveedor.toFixed(2),
        data.es_preferido ?? false,
      ],
    );
    return rows[0];
  });
}

export async function createOrdenCompra(input: CreateOrdenInput) {
  return withTransaction(async (client: DbClient) => {
    const orden = await client.query<{ id: number }>(
      `INSERT INTO pos_ordenes_compra (proveedor_id, estado, observaciones) VALUES ($1, 'borrador', $2) RETURNING id`,
      [input.proveedor_id, input.observaciones ?? null],
    );
    const ordenId = orden.rows[0].id;
    const lineasExport: Array<{
      codigo_interno: string;
      codigo_proveedor: string;
      nombre: string;
      cantidad: number;
      costo_unitario: number;
    }> = [];

    for (const linea of input.lineas) {
      const codigo = linea.codigo_interno.trim().toLowerCase();
      const variant = await getVariantIdBySku(client, codigo);
      if (!variant) {
        throw new AppError(404, "VARIANT_NOT_FOUND", `SKU no encontrado: ${codigo}`);
      }

      const map = await client.query<{
        codigo_proveedor: string;
        costo_proveedor: string;
      }>(
        `SELECT supplier_code AS codigo_proveedor, cost_price::text AS costo_proveedor
         FROM product_supplier_offers
         WHERE supplier_id = $1 AND variant_id = $2`,
        [input.proveedor_id, variant.variant_id],
      );
      if (map.rows.length === 0) {
        throw new AppError(
          400,
          "MAPPING_NOT_FOUND",
          `Sin mapeo proveedor para ${codigo}`,
        );
      }

      const codigoProveedor = map.rows[0].codigo_proveedor;
      const costo = Number(map.rows[0].costo_proveedor);

      await client.query(
        `INSERT INTO pos_ordenes_compra_lineas (orden_id, variant_id, sku_snapshot, codigo_proveedor, cantidad, costo_unitario)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ordenId, variant.variant_id, codigo, codigoProveedor, linea.cantidad, costo],
      );

      lineasExport.push({
        codigo_interno: codigo,
        codigo_proveedor: codigoProveedor,
        nombre: variant.nombre,
        cantidad: linea.cantidad,
        costo_unitario: costo,
      });
    }

    return { orden_id: ordenId, lineas: lineasExport };
  });
}

export async function getOrdenCompra(ordenId: number) {
  const orden = await pool.query(
    `SELECT oc.*, s.name AS proveedor_nombre
     FROM pos_ordenes_compra oc
     JOIN suppliers s ON s.id = oc.proveedor_id
     WHERE oc.id = $1`,
    [ordenId],
  );
  if (orden.rows.length === 0) return null;

  const lineas = await pool.query(
    `SELECT ocl.*, ocl.sku_snapshot AS codigo_interno, COALESCE(p.name, ocl.sku_snapshot) AS producto_nombre
     FROM pos_ordenes_compra_lineas ocl
     LEFT JOIN product_variants pv ON pv.id = ocl.variant_id
     LEFT JOIN products p ON p.id = pv.product_id
     WHERE ocl.orden_id = $1`,
    [ordenId],
  );

  return { ...orden.rows[0], lineas: lineas.rows };
}
