import { pool } from "../../config/db.js";
import { DEFAULT_STOCK_MINIMO } from "../../lib/constants.js";

export async function facturacionDelDia(fecha?: string) {
  const targetDate = fecha ?? new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS cantidad_ventas,
       COALESCE(SUM(total), 0)::float AS facturacion_total,
       COALESCE(SUM(neto_gravado), 0)::float AS neto_total,
       COALESCE(SUM(iva_total), 0)::float AS iva_total
     FROM pos_ventas
     WHERE created_at::date = $1::date AND estado = 'completada'`,
    [targetDate],
  );
  return { fecha: targetDate, ...rows[0] };
}

export async function productosMasVendidos(limit = 10, dias = 30) {
  const { rows } = await pool.query(
    `SELECT lv.sku_snapshot AS codigo_interno, lv.name_snapshot AS nombre,
            SUM(lv.cantidad)::int AS unidades_vendidas,
            SUM(lv.total_linea)::float AS facturacion
     FROM pos_lineas_venta lv
     JOIN pos_ventas v ON v.id = lv.venta_id
     WHERE v.created_at >= NOW() - ($2 || ' days')::interval
       AND v.estado = 'completada'
     GROUP BY lv.sku_snapshot, lv.name_snapshot
     ORDER BY unidades_vendidas DESC
     LIMIT $1`,
    [limit, dias],
  );
  return rows;
}

export async function alertasStockCritico() {
  const { rows } = await pool.query(
    `SELECT LOWER(pv.sku) AS codigo_interno,
            p.name AS nombre,
            pv.stock,
            $1::int AS stock_minimo,
            ($1 - pv.stock) AS deficit
     FROM product_variants pv
     INNER JOIN products p ON p.id = pv.product_id
     WHERE p.is_active = TRUE AND pv.stock <= $1
     ORDER BY deficit DESC, p.name`,
    [DEFAULT_STOCK_MINIMO],
  );
  return rows;
}

export async function rentabilidadEstimada(dias = 30) {
  const { rows } = await pool.query(
    `SELECT lv.sku_snapshot AS codigo_interno, lv.name_snapshot AS nombre,
            SUM(lv.total_linea)::float AS ingresos,
            SUM(lv.cantidad * COALESCE(lv.cost_price_snapshot, 0))::float AS costo_estimado,
            (SUM(lv.total_linea) - SUM(lv.cantidad * COALESCE(lv.cost_price_snapshot, 0)))::float AS margen_estimado
     FROM pos_lineas_venta lv
     JOIN pos_ventas v ON v.id = lv.venta_id
     WHERE v.created_at >= NOW() - ($1 || ' days')::interval
     GROUP BY lv.sku_snapshot, lv.name_snapshot
     ORDER BY margen_estimado DESC
     LIMIT 20`,
    [dias],
  );
  return rows;
}
