import type { DbClient } from "../../../config/db.js";
import { formatPosProductName, getVariantIdBySku } from "../../../lib/catalog.js";
import type { NormalizedInvoice, NormalizedInvoiceItem } from "./schemas.js";

export async function findProveedorByCuit(
  client: DbClient,
  cuit: string | null,
): Promise<{ id: string; name: string } | null> {
  if (!cuit) return null;
  const digits = cuit.replace(/\D/g, "");
  if (digits.length !== 11) return null;
  const { rows } = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM suppliers
     WHERE is_active = TRUE
       AND (
         cuit = $1
         OR regexp_replace(COALESCE(cuit, ''), '[^0-9]', '', 'g') = $1
         OR notes ILIKE '%' || $1 || '%'
       )
     LIMIT 1`,
    [digits],
  );
  return rows[0] ?? null;
}

export async function findOrCreateProveedor(
  client: DbClient,
  cuit: string | null,
  razonSocial: string | null,
): Promise<{ id: string; name: string; created: boolean } | null> {
  const existing = await findProveedorByCuit(client, cuit);
  if (existing) return { ...existing, created: false };
  if (!cuit && !razonSocial) return null;

  const digits = cuit?.replace(/\D/g, "") ?? null;
  const name = (razonSocial?.trim() || `Proveedor ${digits ?? "sin CUIT"}`).slice(0, 200);
  const slugBase = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || `prov-${digits ?? Date.now()}`;

  const { rows } = await client.query<{ id: string; name: string }>(
    `INSERT INTO suppliers (name, slug, cuit, notes, is_active)
     VALUES ($1, $2, $3, $4, TRUE)
     RETURNING id, name`,
    [
      name,
      `${slugBase}-${(digits ?? String(Date.now())).slice(-6)}`,
      digits,
      digits ? `CUIT: ${digits}` : null,
    ],
  );
  return { ...rows[0], created: true };
}

async function matchItem(
  client: DbClient,
  item: NormalizedInvoiceItem,
  proveedorId: string | null,
): Promise<NormalizedInvoiceItem> {
  const code = item.codigo_proveedor?.trim() ?? "";

  if (proveedorId && code) {
    const byOffer = await client.query<{
      variant_id: string;
      sku: string;
      product_name: string;
      attributes: Record<string, string>;
    }>(
      `SELECT pv.id AS variant_id, pv.sku, p.name AS product_name, pv.attributes
       FROM product_supplier_offers pso
       JOIN product_variants pv ON pv.id = pso.variant_id
       JOIN products p ON p.id = pv.product_id
       WHERE pso.supplier_id = $1
         AND lower(pso.supplier_code) = lower($2)
       LIMIT 1`,
      [proveedorId, code],
    );
    if (byOffer.rows[0]) {
      const r = byOffer.rows[0];
      return {
        ...item,
        variant_id: r.variant_id,
        sku: r.sku,
        producto_nombre: formatPosProductName(r.product_name, r.attributes),
        encontrado: true,
        requiere_revision: false,
      };
    }
  }

  if (code) {
    const bySku = await getVariantIdBySku(client, code);
    if (bySku) {
      return {
        ...item,
        variant_id: bySku.variant_id,
        sku: code.trim().toLowerCase(),
        producto_nombre: bySku.nombre,
        encontrado: true,
        requiere_revision: false,
      };
    }
  }

  return {
    ...item,
    variant_id: null,
    sku: null,
    producto_nombre: null,
    encontrado: false,
    requiere_revision: true,
  };
}

/** Matching estricto: código proveedor → SKU. Sin fuzzy por descripción. */
export async function matchInvoiceProducts(
  client: DbClient,
  invoice: NormalizedInvoice,
): Promise<NormalizedInvoice> {
  const proveedor = await findOrCreateProveedor(
    client,
    invoice.proveedor.cuit,
    invoice.proveedor.razon_social,
  );

  const proveedorId = proveedor?.id ?? null;
  const items: NormalizedInvoiceItem[] = [];
  for (const item of invoice.items) {
    items.push(await matchItem(client, item, proveedorId));
  }

  return {
    ...invoice,
    proveedor: {
      ...invoice.proveedor,
      proveedor_id: proveedorId,
      razon_social: proveedor?.name ?? invoice.proveedor.razon_social,
    },
    items,
  };
}
