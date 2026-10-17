import type { DbClient } from "../../config/db.js";
import { pool, withTransaction } from "../../config/db.js";
import { env } from "../../config/env.js";
import {
  formatPosProductName,
  listCatalogForPos,
  lockAndDecrementForSale,
  syncProductsStockBatch,
  type ProductoCaja,
} from "../../lib/catalog.js";
import { DEFAULT_IVA_ALICUOTA } from "../../lib/constants.js";
import { splitPriceWithIva } from "../../lib/iva.js";
import { resolveEffectiveTiers } from "../../lib/qty-discount-scope.js";
import { resolveUnitPrice, type PriceTier } from "../../lib/quantity-pricing.js";
import { insertStockLedger } from "../../lib/stock-ledger.js";
import type { AuthContext } from "../../middleware/auth.js";
import { AppError } from "../../middleware/errors.js";
import {
  actorLabel,
  ensureSaleMovimiento,
  resolveSesionForSale,
} from "../caja/service.js";
import { getClienteFiscalById } from "../clientes/service.js";
import { isArcaConfigured } from "../../config/arca.js";
import { getFiscalStatus, maybeEmitirDespuesDeVenta } from "../fiscal/service.js";
import type { ComprobanteFiscalResponse } from "../fiscal/types.js";
import type { CreateSaleInput } from "./schemas.js";

export type { ProductoCaja };

export type SaleResult = {
  venta_id: number;
  total: number;
  client_sale_id?: string;
  fiscal?: ComprobanteFiscalResponse | null;
  caja_movimiento_id?: number;
};

type LineaDetalle = {
  variant_id: string;
  product_id: string;
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
  stock_before: number;
  stock_after: number;
};

async function findVentaByClientSaleId(
  clientSaleId: string,
): Promise<{
  id: number;
  total: number;
  caja_sesion_id: number | null;
  medio_pago: string;
} | null> {
  const dup = await pool.query<{
    id: number;
    total: string;
    caja_sesion_id: number | null;
    medio_pago: string;
  }>(
    `SELECT id, total, caja_sesion_id, medio_pago FROM pos_ventas WHERE client_sale_id = $1`,
    [clientSaleId],
  );
  if (dup.rows.length === 0) return null;
  return {
    id: dup.rows[0].id,
    total: Number(dup.rows[0].total),
    caja_sesion_id: dup.rows[0].caja_sesion_id,
    medio_pago: dup.rows[0].medio_pago,
  };
}

async function validateClienteId(clienteId: number | undefined): Promise<void> {
  if (clienteId == null) return;
  await getClienteFiscalById(clienteId);
}

async function registerSaleInTransaction(
  client: DbClient,
  input: CreateSaleInput,
  cajaSesionId?: number | null,
  saleActor?: string,
): Promise<{ ventaId: number; totalVenta: number }> {
  let netoTotal = 0;
  let ivaTotal = 0;
  let exentoTotal = 0;
  let totalVenta = 0;

  const lineasDetalle: LineaDetalle[] = [];

  for (const linea of input.lineas) {
    const codigo = linea.codigo_interno.trim().toLowerCase();
    const variant = await lockAndDecrementForSale(client, codigo, linea.cantidad);

    const catalogPrice = resolveUnitPrice(
      variant.precio_venta,
      variant.price_tiers ?? [],
      linea.cantidad,
    );
    // Precio autoritativo desde DB (incluye tramos por cantidad).
    const precio = catalogPrice;

    if (
      linea.precio_unitario != null &&
      catalogPrice > 0 &&
      Math.abs(linea.precio_unitario - catalogPrice) / catalogPrice > 0.02
    ) {
      console.warn(
        `[POS] Precio en caja difiere del catálogo para ${codigo}: ` +
          `caja=${linea.precio_unitario} catálogo=${catalogPrice}`,
      );
    }

    const alicuota = variant.alicuota_iva ?? DEFAULT_IVA_ALICUOTA;
    const totalLinea = precio * linea.cantidad;
    const breakdown = splitPriceWithIva(totalLinea, alicuota);

    lineasDetalle.push({
      variant_id: variant.variant_id,
      product_id: variant.product_id,
      sku_snapshot: variant.sku,
      name_snapshot: formatPosProductName(variant.product_name, variant.attributes),
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
      stock_before: variant.stock_before,
      stock_after: variant.stock_after,
    });

    netoTotal += breakdown.netoGravado;
    ivaTotal += breakdown.iva;
    exentoTotal += breakdown.exento;
    totalVenta += breakdown.total;
  }

  await syncProductsStockBatch(
    client,
    lineasDetalle.map((l) => l.product_id),
  );

  const ventaInsert = await client.query<{ id: number }>(
    `INSERT INTO pos_ventas (
      client_sale_id, cliente_id, canal, medio_pago, estado,
      neto_gravado, iva_total, exento, total, sincronizada_offline, caja_sesion_id
    ) VALUES ($1, $2, 'pos', $3, 'completada', $4, $5, $6, $7, $8, $9)
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
      cajaSesionId ?? null,
    ],
  );
  const ventaId = ventaInsert.rows[0].id;

  for (const ld of lineasDetalle) {
    const lineInsert = await client.query<{ id: number }>(
      `INSERT INTO pos_lineas_venta (
        venta_id, variant_id, sku_snapshot, name_snapshot, cantidad, precio_unitario,
        cost_price_snapshot, supplier_id_snapshot, supplier_code_snapshot, alicuota_iva,
        neto_linea, iva_linea, exento_linea, total_linea
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id`,
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

    await insertStockLedger(client, {
      tipo: "venta_pos",
      canal: "pos",
      actor: saleActor ?? "unknown",
      ref_tipo: "pos_linea_venta",
      ref_id: String(lineInsert.rows[0].id),
      variant_id: ld.variant_id,
      product_id: ld.product_id,
      sku: ld.sku_snapshot,
      delta: -ld.cantidad,
      stock_before: ld.stock_before,
      stock_after: ld.stock_after,
      reason: "baja",
      source: "pos",
      note: null,
      product_name_snapshot: ld.name_snapshot,
    });
  }

  await client.query(
    `INSERT INTO pos_iva_registro (
      tipo, referencia_tipo, referencia_id, fecha_fiscal,
      alicuota, neto_gravado, iva, exento, total
    ) VALUES ('venta', 'pos_venta', $1, CURRENT_DATE, $2, $3, $4, $5, $6)`,
    [ventaId, DEFAULT_IVA_ALICUOTA, netoTotal, ivaTotal, exentoTotal, totalVenta],
  );

  return { ventaId, totalVenta };
}

export async function listProductosCaja(client: DbClient): Promise<ProductoCaja[]> {
  return listCatalogForPos(client);
}

export type ProcessSaleOpts = {
  skipFiscal?: boolean;
  authContext?: AuthContext;
};

let postCommitFaultForTests: (() => void) | null = null;

/** Inyecta un error justo después del COMMIT. Solo tests. */
export function setPostCommitFaultForTests(fn: (() => void) | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("setPostCommitFaultForTests solo se usa con NODE_ENV=test");
  }
  postCommitFaultForTests = fn;
}

async function precioUnitarioDeLinea(
  codigo: string,
  cantidad: number,
): Promise<number | null> {
  const sku = codigo.trim().toLowerCase();
  const { rows } = await pool.query<{
    precio: number;
    scope: string;
    product_tiers: PriceTier[] | null;
    variant_tiers: PriceTier[] | null;
  }>(
    `SELECT COALESCE(pv.sale_price, p.price)::float AS precio,
            COALESCE(p.qty_discount_scope, 'per_variant') AS scope,
            (
              SELECT json_agg(json_build_object('minQty', t.min_qty, 'unitPrice', t.unit_price::float) ORDER BY t.min_qty)
              FROM product_price_tiers t WHERE t.product_id = p.id
            ) AS product_tiers,
            (
              SELECT json_agg(json_build_object('minQty', t.min_qty, 'unitPrice', t.unit_price::float) ORDER BY t.min_qty)
              FROM product_variant_price_tiers t WHERE t.variant_id = pv.id
            ) AS variant_tiers
     FROM product_variants pv
     INNER JOIN products p ON p.id = pv.product_id
     WHERE pv.sku = $1 AND p.is_active = TRUE`,
    [sku],
  );
  const row = rows[0];
  if (!row) return null;
  const tiers = resolveEffectiveTiers(row.scope, row.product_tiers ?? [], row.variant_tiers ?? []);
  return resolveUnitPrice(Number(row.precio), tiers, cantidad);
}

/** D7: con ARCA activo, una venta de $0 no llega a tocar stock. */
async function assertImportesSiArca(input: CreateSaleInput): Promise<void> {
  if (!isArcaConfigured()) return;
  let totalCents = 0;
  let cotizadas = 0;
  for (const linea of input.lineas) {
    const precio = await precioUnitarioDeLinea(linea.codigo_interno, linea.cantidad);
    if (precio == null) continue;
    cotizadas += 1;
    const lineCents = Math.round(precio * linea.cantidad * 100);
    if (lineCents <= 0) {
      throw new AppError(400, "VENTA_SIN_IMPORTES", "La venta no tiene importes facturables");
    }
    totalCents += lineCents;
  }
  if (cotizadas > 0 && totalCents <= 0) {
    throw new AppError(400, "VENTA_SIN_IMPORTES", "La venta no tiene importes facturables");
  }
}

function fiscalPorFalloPosterior(err: unknown): ComprobanteFiscalResponse {
  const message = err instanceof Error ? err.message : "Error posterior al registro de la venta";
  return {
    estado: "error",
    comprobante: null,
    cbte_tipo: 0,
    cbte_tipo_label: "",
    cbte_nro: null,
    punto_venta: 0,
    cae: null,
    cae_vencimiento: null,
    qr_url: null,
    error_message: message,
    ambiente: "",
  };
}

/** La venta ya está confirmada: esta función no lanza. */
async function emitirSeguro(
  ventaId: number,
  opts?: ProcessSaleOpts,
): Promise<ComprobanteFiscalResponse | null> {
  try {
    postCommitFaultForTests?.();
    return await maybeEmitirDespuesDeVenta(ventaId, {
      skipFiscal: opts?.skipFiscal === true,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "emision posterior al commit",
        venta_id: ventaId,
        error: err instanceof Error ? err.message : "error",
      }),
    );
    try {
      const existing = await getFiscalStatus(ventaId);
      if (existing?.cae) return { ...existing, estado: "emitido" };
      if (existing) return existing;
    } catch {
      // La respuesta de la venta no depende de poder releer el comprobante.
    }
    return fiscalPorFalloPosterior(err);
  }
}

export async function processSale(
  input: CreateSaleInput,
  opts?: ProcessSaleOpts,
): Promise<SaleResult> {
  // Resolve caja session BEFORE touching stock (D-FLAG / CAJA_SIN_SESION).
  const resolved = await resolveSesionForSale({
    caja_sesion_id: input.caja_sesion_id,
    sincronizada_offline: input.sincronizada_offline === true,
    requireSession: env.POS_CAJA_REQUIRE_SESSION,
  });

  await validateClienteId(input.cliente_id);

  if (input.client_sale_id) {
    const existing = await findVentaByClientSaleId(input.client_sale_id);
    if (existing) {
      let cajaMovimientoId: number | undefined;
      if (existing.caja_sesion_id != null) {
        const ensured = await withTransaction(async (client) =>
          ensureSaleMovimiento(client, {
            sesion_id: existing.caja_sesion_id!,
            amount: existing.total,
            payment_method: existing.medio_pago,
            source_id: String(existing.id),
            created_by_label: actorLabel(opts?.authContext),
          }),
        );
        cajaMovimientoId = ensured.row.id;
      }
      const yaEmitido = await getFiscalStatus(existing.id);
      const fiscal = yaEmitido ?? (await emitirSeguro(existing.id));
      throw new AppError(409, "DUPLICATE_OFFLINE_SALE", "Venta ya registrada", {
        venta_id: existing.id,
        total: existing.total,
        fiscal,
        caja_movimiento_id: cajaMovimientoId,
      });
    }
  }

  await assertImportesSiArca(input);

  const label = actorLabel(opts?.authContext);

  let lastError: unknown;
  let committed: {
    ventaId: number;
    totalVenta: number;
    cajaMovimientoId: number | undefined;
  } | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      committed = await withTransaction(async (client) => {
        const sale = await registerSaleInTransaction(
          client,
          input,
          resolved?.sesion_id ?? null,
          label,
        );
        let movId: number | undefined;
        if (resolved) {
          const ensured = await ensureSaleMovimiento(client, {
            sesion_id: resolved.sesion_id,
            amount: sale.totalVenta,
            payment_method: input.medio_pago,
            source_id: String(sale.ventaId),
            created_by_label: label,
            post_cierre_offline: resolved.post_cierre_offline,
          });
          movId = ensured.row.id;
        }
        return {
          ventaId: sale.ventaId,
          totalVenta: sale.totalVenta,
          cajaMovimientoId: movId,
        };
      });
      break;
    } catch (err: unknown) {
      lastError = err;
      const isDeadlock =
        err != null &&
        typeof err === "object" &&
        "code" in err &&
        (err.code === "40P01" || err.code === "40001");

      if (isDeadlock && attempt < 3) {
        const backoffMs = 50 + Math.random() * 100;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      throw err;
    }
  }

  if (!committed) throw lastError;

  const fiscal = await emitirSeguro(committed.ventaId, opts);
  return {
    venta_id: committed.ventaId,
    total: committed.totalVenta,
    client_sale_id: input.client_sale_id,
    fiscal,
    caja_movimiento_id: committed.cajaMovimientoId,
  };
}

export async function processOfflineBatch(
  ventas: CreateSaleInput[],
  authContext?: AuthContext,
): Promise<{
  procesadas: number;
  duplicadas: number;
  errores: Array<{ client_sale_id: string; error: string }>;
  resultados: Array<{
    client_sale_id: string;
    venta_id: number;
    total: number;
    fiscal?: ComprobanteFiscalResponse | null;
  }>;
}> {
  const resultados: Array<{
    client_sale_id: string;
    venta_id: number;
    total: number;
    fiscal?: ComprobanteFiscalResponse | null;
  }> = [];
  const errores: Array<{ client_sale_id: string; error: string }> = [];
  let duplicadas = 0;
  let procesadas = 0;

  for (const venta of ventas) {
    try {
      const result = await processSale(
        {
          ...venta,
          sincronizada_offline: true,
        },
        { skipFiscal: true, authContext },
      );
      procesadas++;
      if (venta.client_sale_id) {
        const fiscal = await maybeEmitirDespuesDeVenta(result.venta_id);
        resultados.push({
          client_sale_id: venta.client_sale_id,
          venta_id: result.venta_id,
          total: result.total,
          fiscal,
        });
      }
    } catch (err) {
      if (err instanceof AppError && err.code === "DUPLICATE_OFFLINE_SALE") {
        duplicadas++;
        const details = err.details as {
          venta_id: number;
          total?: number;
          fiscal?: ComprobanteFiscalResponse | null;
        };
        if (venta.client_sale_id) {
          let fiscal = details.fiscal ?? null;
          if (!fiscal) {
            fiscal = await maybeEmitirDespuesDeVenta(details.venta_id);
          }
          resultados.push({
            client_sale_id: venta.client_sale_id,
            venta_id: details.venta_id,
            total: details.total ?? 0,
            fiscal,
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
