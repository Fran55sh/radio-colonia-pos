import { pool, withTransaction } from "../../config/db.js";
import type { DbClient } from "../../config/db.js";

export async function libroIvaVentas(desde?: string, hasta?: string) {
  const params: string[] = [];
  let where = "tipo = 'venta'";
  if (desde) {
    params.push(desde);
    where += ` AND fecha_fiscal >= $${params.length}`;
  }
  if (hasta) {
    params.push(hasta);
    where += ` AND fecha_fiscal <= $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM pos_iva_registro WHERE ${where} ORDER BY fecha_fiscal DESC, id DESC`,
    params,
  );
  return rows;
}

export async function libroIvaCompras(desde?: string, hasta?: string) {
  const params: string[] = [];
  let where = "tipo = 'compra'";
  if (desde) {
    params.push(desde);
    where += ` AND fecha_fiscal >= $${params.length}`;
  }
  if (hasta) {
    params.push(hasta);
    where += ` AND fecha_fiscal <= $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM pos_iva_registro WHERE ${where} ORDER BY fecha_fiscal DESC, id DESC`,
    params,
  );
  return rows;
}

export async function registrarFacturaCompra(data: {
  proveedor_id: string;
  numero_comprobante: string;
  fecha_fiscal: string;
  neto_gravado: number;
  iva_total: number;
  exento: number;
  total: number;
  alicuota: number;
}) {
  return withTransaction(async (client: DbClient) => {
    const factura = await client.query<{ id: number }>(
      `INSERT INTO pos_facturas_compra (
        proveedor_id, numero_comprobante, fecha_fiscal,
        neto_gravado, iva_total, exento, total
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        data.proveedor_id,
        data.numero_comprobante,
        data.fecha_fiscal,
        data.neto_gravado,
        data.iva_total,
        data.exento,
        data.total,
      ],
    );
    const facturaId = factura.rows[0].id;

    await client.query(
      `INSERT INTO pos_iva_registro (
        tipo, referencia_tipo, referencia_id, fecha_fiscal,
        alicuota, neto_gravado, iva, exento, total, comprobante
      ) VALUES ('compra', 'pos_factura_compra', $1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        facturaId,
        data.fecha_fiscal,
        data.alicuota,
        data.neto_gravado,
        data.iva_total,
        data.exento,
        data.total,
        data.numero_comprobante,
      ],
    );

    return { factura_id: facturaId };
  });
}
