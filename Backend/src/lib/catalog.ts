import type { DbClient } from "../config/db.js";
import { AppError } from "../middleware/errors.js";
import { DEFAULT_IVA_ALICUOTA } from "./constants.js";

export type CatalogRow = {
  variant_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  attributes: Record<string, string>;
  precio_venta: number;
  stock: number;
  cost_price: number | null;
  supplier_id: string | null;
  supplier_code: string | null;
};

/** Nombre visible en caja: producto + valores de atributos (ej. "Cable 1mt"). */
export function formatPosProductName(
  productName: string,
  attributes: Record<string, string> | null | undefined,
): string {
  if (!attributes || typeof attributes !== "object") return productName;
  const values = Object.values(attributes)
    .map((v) => String(v).trim())
    .filter(Boolean);
  if (values.length === 0) return productName;
  return `${productName} ${values.join(" ")}`.trim();
}

export type ProductoCaja = {
  codigo_interno: string;
  nombre: string;
  precio_venta: number;
  stock: number;
  alicuota_iva: number;
};

const CATALOG_SELECT = `
  SELECT
    pv.id AS variant_id,
    p.id AS product_id,
    LOWER(pv.sku) AS sku,
    p.name AS product_name,
    pv.attributes AS attributes,
    COALESCE(pv.sale_price, p.price)::float AS precio_venta,
    pv.stock,
    (
      SELECT pso.cost_price::float
      FROM product_supplier_offers pso
      WHERE pso.variant_id = pv.id
      ORDER BY pso.is_preferred DESC, pso.updated_at DESC
      LIMIT 1
    ) AS cost_price,
    (
      SELECT pso.supplier_id
      FROM product_supplier_offers pso
      WHERE pso.variant_id = pv.id
      ORDER BY pso.is_preferred DESC, pso.updated_at DESC
      LIMIT 1
    ) AS supplier_id,
    (
      SELECT pso.supplier_code
      FROM product_supplier_offers pso
      WHERE pso.variant_id = pv.id
      ORDER BY pso.is_preferred DESC, pso.updated_at DESC
      LIMIT 1
    ) AS supplier_code
  FROM product_variants pv
  INNER JOIN products p ON p.id = pv.product_id
  WHERE p.is_active = TRUE
`;

export async function listCatalogForPos(client: DbClient): Promise<ProductoCaja[]> {
  const { rows } = await client.query<CatalogRow>(
    `${CATALOG_SELECT}
     ORDER BY p.name, pv.sku`,
  );
  return rows.map((r) => ({
    codigo_interno: r.sku,
    nombre: formatPosProductName(r.product_name, r.attributes),
    precio_venta: r.precio_venta,
    stock: r.stock,
    alicuota_iva: DEFAULT_IVA_ALICUOTA,
  }));
}

export async function getVariantForSale(
  client: DbClient,
  sku: string,
): Promise<CatalogRow> {
  const normalized = sku.trim().toLowerCase();
  const { rows } = await client.query<CatalogRow>(
    `${CATALOG_SELECT}
     AND LOWER(pv.sku) = $1
     FOR UPDATE OF pv`,
    [normalized],
  );
  if (rows.length === 0) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", `Producto no encontrado: ${normalized}`);
  }
  return rows[0];
}

export async function decrementVariantStock(
  client: DbClient,
  sku: string,
  quantity: number,
): Promise<{ sku: string; stock: number }> {
  const normalized = sku.trim().toLowerCase();
  const { rows } = await client.query<{ sku: string; stock: number }>(
    `UPDATE product_variants pv
     SET stock = pv.stock - $1
     FROM products p
     WHERE p.id = pv.product_id
       AND LOWER(pv.sku) = $2
       AND p.is_active = TRUE
       AND pv.stock >= $1
     RETURNING LOWER(pv.sku) AS sku, pv.stock`,
    [quantity, normalized],
  );
  if (rows.length === 0) {
    throw new AppError(409, "INSUFFICIENT_STOCK", `Stock insuficiente para ${normalized}`, {
      codigo_interno: normalized,
      cantidad_solicitada: quantity,
    });
  }
  return rows[0];
}

export async function getVariantIdBySku(
  client: DbClient,
  sku: string,
): Promise<{ variant_id: string; product_id: string; nombre: string } | null> {
  const normalized = sku.trim().toLowerCase();
  const { rows } = await client.query<{
    variant_id: string;
    product_id: string;
    nombre: string;
  }>(
    `SELECT pv.id AS variant_id, p.id AS product_id, p.name AS nombre
     FROM product_variants pv
     INNER JOIN products p ON p.id = pv.product_id
     WHERE LOWER(pv.sku) = $1`,
    [normalized],
  );
  return rows[0] ?? null;
}
