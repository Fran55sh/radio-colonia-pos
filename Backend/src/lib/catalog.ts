import type { DbClient } from "../config/db.js";
import { AppError } from "../middleware/errors.js";
import { DEFAULT_IVA_ALICUOTA } from "./constants.js";
import { resolveEffectiveTiers } from "./qty-discount-scope.js";
import { normalizeTiers, type PriceTier } from "./quantity-pricing.js";

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
  price_tiers: PriceTier[] | null;
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
  variant_id: string;
  codigo_interno: string;
  nombre: string;
  precio_venta: number;
  stock: number;
  alicuota_iva: number;
  price_tiers: PriceTier[];
};

const TIER_JSON_AGG = `
  json_agg(
    json_build_object('minQty', t.min_qty, 'unitPrice', t.unit_price::float)
    ORDER BY t.min_qty
  )
`;

function parseTiers(raw: unknown): PriceTier[] {
  let data: unknown = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data) as unknown;
    } catch {
      return [];
    }
  }
  if (!data || !Array.isArray(data)) return [];
  return normalizeTiers(
    data.map((t) => {
      const row = t as { minQty?: number; min_qty?: number; unitPrice?: number; unit_price?: number };
      return {
        minQty: Number(row.minQty ?? row.min_qty ?? 0),
        unitPrice: Number(row.unitPrice ?? row.unit_price ?? 0),
      };
    }),
  );
}

function tiersFromRow(
  scope: string | null | undefined,
  productRaw: unknown,
  variantRaw: unknown,
): PriceTier[] {
  return resolveEffectiveTiers(scope, parseTiers(productRaw), parseTiers(variantRaw));
}

/** Listado caja: sin offers (no se usan en la UI). SKUs se asumen normalizados a minúsculas en DB. */
const LIST_CATALOG_SELECT = `
  SELECT
    pv.id AS variant_id,
    p.id AS product_id,
    pv.sku AS sku,
    p.name AS product_name,
    pv.attributes AS attributes,
    COALESCE(pv.sale_price, p.price)::float AS precio_venta,
    pv.stock,
    COALESCE(p.qty_discount_scope, 'per_variant') AS qty_discount_scope,
    (
      SELECT ${TIER_JSON_AGG}
      FROM product_price_tiers t
      WHERE t.product_id = p.id
    ) AS product_price_tiers,
    (
      SELECT ${TIER_JSON_AGG}
      FROM product_variant_price_tiers t
      WHERE t.variant_id = pv.id
    ) AS variant_price_tiers
  FROM product_variants pv
  INNER JOIN products p ON p.id = pv.product_id
  WHERE p.is_active = TRUE
`;

export async function listCatalogForPos(client: DbClient): Promise<ProductoCaja[]> {
  const { rows } = await client.query<{
    variant_id: string;
    sku: string;
    product_name: string;
    attributes: Record<string, string>;
    precio_venta: number;
    stock: number;
    qty_discount_scope: string;
    product_price_tiers: unknown;
    variant_price_tiers: unknown;
  }>(
    `${LIST_CATALOG_SELECT}
     ORDER BY p.name, pv.sort_order, pv.sku`,
  );
  return rows.map((r) => ({
    variant_id: r.variant_id,
    codigo_interno: r.sku,
    nombre: formatPosProductName(r.product_name, r.attributes),
    precio_venta: r.precio_venta,
    stock: r.stock,
    alicuota_iva: DEFAULT_IVA_ALICUOTA,
    price_tiers: tiersFromRow(r.qty_discount_scope, r.product_price_tiers, r.variant_price_tiers),
  }));
}

type SaleDecrementRow = {
  variant_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  attributes: Record<string, string>;
  precio_venta: number;
  stock: number;
  qty_discount_scope: string;
  product_price_tiers: unknown;
  variant_price_tiers: unknown;
  offer: {
    cost_price: number | null;
    supplier_id: string | null;
    supplier_code: string | null;
  } | null;
};

/**
 * Un solo round-trip: descuenta stock (UPDATE condicional) y devuelve datos de venta.
 * WHERE pv.sku = $2 usa el índice UNIQUE (SKU ya normalizado a minúsculas en Node).
 */
export async function lockAndDecrementForSale(
  client: DbClient,
  sku: string,
  quantity: number,
): Promise<CatalogRow & { price_tiers: PriceTier[] }> {
  const normalized = sku.trim().toLowerCase();
  const { rows } = await client.query<SaleDecrementRow>(
    `UPDATE product_variants pv
     SET stock = pv.stock - $1
     FROM products p
     WHERE p.id = pv.product_id
       AND pv.sku = $2
       AND p.is_active = TRUE
       AND pv.stock >= $1
     RETURNING
       pv.id AS variant_id,
       p.id AS product_id,
       pv.sku AS sku,
       p.name AS product_name,
       pv.attributes AS attributes,
       COALESCE(pv.sale_price, p.price)::float AS precio_venta,
       pv.stock,
       (
         SELECT json_build_object(
           'cost_price', pso.cost_price::float,
           'supplier_id', pso.supplier_id,
           'supplier_code', pso.supplier_code
         )
         FROM product_supplier_offers pso
         WHERE pso.variant_id = pv.id
         ORDER BY pso.is_preferred DESC, pso.updated_at DESC
         LIMIT 1
       ) AS offer,
       COALESCE(p.qty_discount_scope, 'per_variant') AS qty_discount_scope,
       (
         SELECT ${TIER_JSON_AGG}
         FROM product_price_tiers t
         WHERE t.product_id = p.id
       ) AS product_price_tiers,
       (
         SELECT ${TIER_JSON_AGG}
         FROM product_variant_price_tiers t
         WHERE t.variant_id = pv.id
       ) AS variant_price_tiers`,
    [quantity, normalized],
  );

  if (rows.length === 0) {
    const exists = await client.query<{ id: string; stock: number }>(
      `SELECT pv.id, pv.stock
       FROM product_variants pv
       INNER JOIN products p ON p.id = pv.product_id
       WHERE pv.sku = $1 AND p.is_active = TRUE`,
      [normalized],
    );
    if (exists.rows.length === 0) {
      throw new AppError(404, "PRODUCT_NOT_FOUND", `Producto no encontrado: ${normalized}`);
    }
    throw new AppError(409, "INSUFFICIENT_STOCK", `Stock insuficiente para ${normalized}`, {
      codigo_interno: normalized,
      cantidad_solicitada: quantity,
      stock_disponible: exists.rows[0].stock,
    });
  }

  const row = rows[0];
  const offer = row.offer;
  return {
    variant_id: row.variant_id,
    product_id: row.product_id,
    sku: row.sku,
    product_name: row.product_name,
    attributes: row.attributes,
    precio_venta: row.precio_venta,
    stock: row.stock,
    cost_price: offer?.cost_price ?? null,
    supplier_id: offer?.supplier_id ?? null,
    supplier_code: offer?.supplier_code ?? null,
    price_tiers: tiersFromRow(
      row.qty_discount_scope,
      row.product_price_tiers,
      row.variant_price_tiers,
    ),
  };
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
     WHERE pv.sku = $1`,
    [normalized],
  );
  return rows[0] ?? null;
}

/** Incrementa stock de venta al recibir mercadería (compras). */
export async function lockAndIncrementForPurchase(
  client: DbClient,
  variantId: string,
  quantity: number,
  costUnitario?: number,
): Promise<{ variant_id: string; sku: string; stock: number }> {
  if (quantity <= 0) {
    throw new AppError(400, "INVALID_QTY", "La cantidad a ingresar debe ser > 0");
  }

  const { rows } = await client.query<{
    variant_id: string;
    sku: string;
    stock: number;
  }>(
    `UPDATE product_variants
     SET stock = stock + $1,
         cost_price = COALESCE($3::numeric, cost_price)
     WHERE id = $2
     RETURNING id AS variant_id, sku, stock`,
    [quantity, variantId, costUnitario != null ? costUnitario.toFixed(2) : null],
  );

  if (rows.length === 0) {
    throw new AppError(404, "VARIANT_NOT_FOUND", `Variante no encontrada: ${variantId}`);
  }
  return rows[0];
}
