import type { DbClient } from "../../../config/db.js";
import { formatPosProductName, getVariantIdBySku } from "../../../lib/catalog.js";
import { slugify } from "../../../lib/slugify.js";
import { AppError } from "../../../middleware/errors.js";
import type { NormalizedInvoice, NormalizedInvoiceItem } from "./schemas.js";

function normalizeCuitDigits(cuit: string | null | undefined): string | null {
  if (!cuit) return null;
  const digits = cuit.replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

export async function findProveedorByCuit(
  client: DbClient,
  cuit: string | null,
): Promise<{ id: string; name: string } | null> {
  const digits = normalizeCuitDigits(cuit);
  if (!digits) return null;
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

/** Solo busca; no inserta. Para matching/revisión. */
export async function resolveProveedorForReview(
  client: DbClient,
  cuit: string | null,
  razonSocial: string | null,
): Promise<{
  id: string | null;
  name: string | null;
  se_creara: boolean;
}> {
  const existing = await findProveedorByCuit(client, cuit);
  if (existing) {
    return { id: existing.id, name: existing.name, se_creara: false };
  }
  const digits = normalizeCuitDigits(cuit);
  const name = razonSocial?.trim() || null;
  const canCreate = Boolean(digits && name);
  return {
    id: null,
    name: name ?? (digits ? `Proveedor ${digits}` : null),
    se_creara: canCreate,
  };
}

/**
 * Crea o reutiliza proveedor dentro de la TX de ejecución.
 * Requiere CUIT válido + razón social si no existe.
 */
export async function findOrCreateProveedorOnExecute(
  client: DbClient,
  cuit: string | null,
  razonSocial: string | null,
  existingId: string | null,
): Promise<{ id: string; name: string; created: boolean }> {
  if (existingId) {
    const { rows } = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM suppliers WHERE id = $1 LIMIT 1`,
      [existingId],
    );
    if (rows[0]) return { ...rows[0], created: false };
  }

  const existing = await findProveedorByCuit(client, cuit);
  if (existing) return { ...existing, created: false };

  const digits = normalizeCuitDigits(cuit);
  const name = (razonSocial?.trim() || "").slice(0, 200);
  if (!digits || !name) {
    throw new AppError(
      400,
      "PROVEEDOR_INCOMPLETO",
      "Para crear el proveedor se requieren CUIT válido (11 dígitos) y razón social",
    );
  }

  const slugBase =
    slugify(name).slice(0, 60) || `prov-${digits.slice(-6)}`;

  try {
    const { rows } = await client.query<{ id: string; name: string }>(
      `INSERT INTO suppliers (name, slug, cuit, notes, is_active)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id, name`,
      [name, `${slugBase}-${digits.slice(-6)}`, digits, `CUIT: ${digits}`],
    );
    return { ...rows[0], created: true };
  } catch (err) {
    // Carrera: otro proceso creó el mismo CUIT
    const raced = await findProveedorByCuit(client, digits);
    if (raced) return { ...raced, created: false };
    throw err;
  }
}

/** @deprecated Prefer resolveProveedorForReview / findOrCreateProveedorOnExecute */
export async function findOrCreateProveedor(
  client: DbClient,
  cuit: string | null,
  razonSocial: string | null,
): Promise<{ id: string; name: string; created: boolean } | null> {
  const resolved = await resolveProveedorForReview(client, cuit, razonSocial);
  if (resolved.id) return { id: resolved.id, name: resolved.name!, created: false };
  return null;
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
        alicuota_iva: item.alicuota_iva ?? 21,
        descuento_porcentaje: item.descuento_porcentaje ?? 0,
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
        alicuota_iva: item.alicuota_iva ?? 21,
        descuento_porcentaje: item.descuento_porcentaje ?? 0,
      };
    }
  }

  return {
    ...item,
    variant_id: item.variant_id,
    sku: item.sku,
    producto_nombre: item.producto_nombre,
    encontrado: Boolean(item.variant_id),
    requiere_revision: !item.variant_id,
    alicuota_iva: item.alicuota_iva ?? 21,
    descuento_porcentaje: item.descuento_porcentaje ?? 0,
  };
}

/** Matching estricto: código proveedor → SKU. Sin crear proveedor. */
export async function matchInvoiceProducts(
  client: DbClient,
  invoice: NormalizedInvoice,
): Promise<NormalizedInvoice> {
  const proveedor = await resolveProveedorForReview(
    client,
    invoice.proveedor.cuit,
    invoice.proveedor.razon_social,
  );

  const proveedorId = proveedor.id;
  const items: NormalizedInvoiceItem[] = [];
  for (const item of invoice.items) {
    items.push(await matchItem(client, item, proveedorId));
  }

  return {
    ...invoice,
    proveedor: {
      ...invoice.proveedor,
      proveedor_id: proveedorId,
      razon_social: proveedor.name ?? invoice.proveedor.razon_social,
      se_creara: proveedor.se_creara,
    },
    items,
  };
}

/**
 * Verifica conflicto de mapeo: mismo (proveedor, código) → otra variante.
 * Si hay conflicto y no confirmar_cambio_mapeo → error.
 */
export async function assertSupplierCodeMapping(
  client: DbClient,
  proveedorId: string,
  codigoProveedor: string,
  variantId: string,
  confirmarCambio: boolean,
): Promise<void> {
  const code = codigoProveedor.trim();
  if (!code) return;

  const { rows } = await client.query<{ variant_id: string; sku: string }>(
    `SELECT pso.variant_id, pv.sku
     FROM product_supplier_offers pso
     JOIN product_variants pv ON pv.id = pso.variant_id
     WHERE pso.supplier_id = $1
       AND lower(pso.supplier_code) = lower($2)
     LIMIT 1`,
    [proveedorId, code],
  );
  const existing = rows[0];
  if (!existing) return;
  if (existing.variant_id === variantId) return;
  if (confirmarCambio) return;

  throw new AppError(
    409,
    "MAPEO_CONFLICTO",
    `El código proveedor "${code}" ya está vinculado al SKU ${existing.sku}. Confirmá el cambio de mapeo.`,
  );
}
