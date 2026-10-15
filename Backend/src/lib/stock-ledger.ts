import type { DbClient } from "../config/db.js";

export type StockLedgerTipo =
  | "saldo_inicial"
  | "venta_pos"
  | "venta_web"
  | "cancelacion_web"
  | "compra_factura"
  | "reverso_compra_factura"
  | "ajuste_manual"
  | "conteo"
  | "alta_inicial"
  | "import_csv"
  | "ingreso_proveedor_manual"
  | "baja_variante";

export type StockLedgerCanal = "pos" | "web" | "admin";

export type StockLedgerReason = "alta" | "baja" | "ajuste" | "conteo";

export type StockLedgerSource = "manual" | "order" | "pos" | "import" | "system";

export type StockLedgerInput = {
  tipo: StockLedgerTipo;
  canal: StockLedgerCanal;
  actor: string | null;
  ref_tipo: string | null;
  ref_id: string | null;
  variant_id: string | null;
  product_id: string;
  sku: string | null;
  delta: number;
  stock_before: number;
  stock_after: number;
  reason: StockLedgerReason;
  source: StockLedgerSource;
  note?: string | null;
  product_name_snapshot?: string | null;
};

/** No-op unless POS_STOCK_LEDGER_ENABLED=true (requires ecommerce 0022 columns). */
export function isPosStockLedgerEnabled(): boolean {
  return process.env.POS_STOCK_LEDGER_ENABLED === "true";
}

/**
 * Insert into inventory_movements (same contract as ecommerce extended ledger).
 * No-op when POS_STOCK_LEDGER_ENABLED !== 'true'.
 */
export async function insertStockLedger(
  client: DbClient,
  row: StockLedgerInput,
): Promise<void> {
  if (!isPosStockLedgerEnabled()) return;

  await client.query(
    `INSERT INTO inventory_movements (
       tipo, canal, actor, ref_tipo, ref_id,
       variant_id, product_id, sku, delta,
       stock_before, stock_after, reason, source, note,
       product_name_snapshot
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9,
       $10, $11, $12, $13, $14,
       $15
     )`,
    [
      row.tipo,
      row.canal,
      row.actor,
      row.ref_tipo,
      row.ref_id,
      row.variant_id,
      row.product_id,
      row.sku,
      row.delta,
      row.stock_before,
      row.stock_after,
      row.reason,
      row.source,
      row.note?.trim() ? row.note.trim() : null,
      row.product_name_snapshot ?? null,
    ],
  );
}
