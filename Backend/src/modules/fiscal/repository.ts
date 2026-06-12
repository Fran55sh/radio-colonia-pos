import { pool } from "../../config/db.js";
import type { ClienteFiscal, ComprobanteFiscalResponse, FiscalEstado, LineaFiscal } from "./types.js";
import { cbteTipoLabel, formatComprobanteNumero } from "./mappers.js";

export type ComprobanteRow = {
  id: number;
  venta_id: number;
  estado: FiscalEstado;
  ambiente: string;
  emisor_cuit: string;
  punto_venta: number;
  cbte_tipo: number;
  cbte_nro: number | null;
  fecha_cbte: string | null;
  cae: string | null;
  cae_vencimiento: string | null;
  qr_url: string | null;
  error_message: string | null;
};

export async function loadVentaFiscalContext(ventaId: number): Promise<{
  venta_id: number;
  cliente_id: number | null;
  neto_gravado: number;
  iva_total: number;
  exento: number;
  total: number;
  lineas: LineaFiscal[];
  cliente: ClienteFiscal | null;
} | null> {
  const ventaRes = await pool.query<{
    id: number;
    cliente_id: number | null;
    neto_gravado: string;
    iva_total: string;
    exento: string;
    total: string;
  }>(
    `SELECT id, cliente_id, neto_gravado, iva_total, exento, total
     FROM pos_ventas WHERE id = $1`,
    [ventaId],
  );
  if (ventaRes.rows.length === 0) return null;

  const v = ventaRes.rows[0];
  const lineasRes = await pool.query<{
    neto_linea: string;
    iva_linea: string;
    exento_linea: string;
    alicuota_iva: string;
  }>(
    `SELECT neto_linea, iva_linea, exento_linea, alicuota_iva
     FROM pos_lineas_venta WHERE venta_id = $1`,
    [ventaId],
  );

  let cliente: ClienteFiscal | null = null;
  if (v.cliente_id) {
    const cRes = await pool.query<ClienteFiscal>(
      `SELECT id, nombre, documento, documento_tipo_afip, condicion_iva_receptor_id, razon_social
       FROM pos_clientes WHERE id = $1`,
      [v.cliente_id],
    );
    cliente = cRes.rows[0] ?? null;
  }

  return {
    venta_id: v.id,
    cliente_id: v.cliente_id,
    neto_gravado: Number(v.neto_gravado),
    iva_total: Number(v.iva_total),
    exento: Number(v.exento),
    total: Number(v.total),
    lineas: lineasRes.rows.map((l) => ({
      neto_linea: Number(l.neto_linea),
      iva_linea: Number(l.iva_linea),
      exento_linea: Number(l.exento_linea),
      alicuota_iva: Number(l.alicuota_iva),
    })),
    cliente,
  };
}

export async function getComprobanteByVentaId(ventaId: number): Promise<ComprobanteRow | null> {
  const { rows } = await pool.query<ComprobanteRow>(
    `SELECT id, venta_id, estado, ambiente, emisor_cuit, punto_venta, cbte_tipo,
            cbte_nro, fecha_cbte::text, cae, cae_vencimiento::text, qr_url, error_message
     FROM pos_comprobantes_fiscales WHERE venta_id = $1`,
    [ventaId],
  );
  return rows[0] ?? null;
}

export async function ensureComprobantePendiente(
  ventaId: number,
  data: {
    ambiente: string;
    emisor_cuit: string;
    punto_venta: number;
    cbte_tipo: number;
    doc_tipo: number;
    doc_nro: number;
    condicion_iva_receptor_id: number;
    neto_gravado: number;
    iva_total: number;
    exento: number;
    total: number;
  },
): Promise<ComprobanteRow> {
  const existing = await getComprobanteByVentaId(ventaId);
  if (existing) return existing;

  const { rows } = await pool.query<ComprobanteRow>(
    `INSERT INTO pos_comprobantes_fiscales (
      venta_id, estado, ambiente, emisor_cuit, punto_venta, cbte_tipo,
      doc_tipo, doc_nro, condicion_iva_receptor_id,
      neto_gravado, iva_total, exento, total
    ) VALUES ($1, 'pendiente', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id, venta_id, estado, ambiente, emisor_cuit, punto_venta, cbte_tipo,
              cbte_nro, fecha_cbte::text, cae, cae_vencimiento::text, qr_url, error_message`,
    [
      ventaId,
      data.ambiente,
      data.emisor_cuit,
      data.punto_venta,
      data.cbte_tipo,
      data.doc_tipo,
      data.doc_nro,
      data.condicion_iva_receptor_id,
      data.neto_gravado,
      data.iva_total,
      data.exento,
      data.total,
    ],
  );
  return rows[0];
}

export async function marcarComprobanteEmitido(
  ventaId: number,
  data: {
    cbte_nro: number;
    fecha_cbte: string;
    cae: string;
    cae_vencimiento: string;
    qr_url: string;
    raw_response: unknown;
  },
): Promise<void> {
  await pool.query(
    `UPDATE pos_comprobantes_fiscales SET
      estado = 'emitido',
      cbte_nro = $2,
      fecha_cbte = $3::date,
      cae = $4,
      cae_vencimiento = $5::date,
      qr_url = $6,
      raw_response = $7,
      error_code = NULL,
      error_message = NULL,
      updated_at = NOW()
     WHERE venta_id = $1`,
    [
      ventaId,
      data.cbte_nro,
      data.fecha_cbte,
      data.cae,
      data.cae_vencimiento,
      data.qr_url,
      JSON.stringify(data.raw_response),
    ],
  );

  const comp = await getComprobanteByVentaId(ventaId);
  if (comp?.cbte_nro) {
    const comprobanteStr = formatComprobanteNumero(
      comp.punto_venta,
      comp.cbte_tipo,
      comp.cbte_nro,
    );
    await pool.query(
      `UPDATE pos_iva_registro SET comprobante = $2
       WHERE referencia_tipo = 'pos_venta' AND referencia_id = $1`,
      [ventaId, comprobanteStr],
    );
  }
}

export async function marcarComprobanteError(
  ventaId: number,
  errorCode: string,
  errorMessage: string,
  raw?: unknown,
): Promise<void> {
  await pool.query(
    `UPDATE pos_comprobantes_fiscales SET
      estado = 'error',
      error_code = $2,
      error_message = $3,
      raw_response = $4,
      updated_at = NOW()
     WHERE venta_id = $1`,
    [ventaId, errorCode, errorMessage, raw ? JSON.stringify(raw) : null],
  );
}

export function rowToFiscalResponse(row: ComprobanteRow): ComprobanteFiscalResponse {
  const comprobante =
    row.cbte_nro != null
      ? formatComprobanteNumero(row.punto_venta, row.cbte_tipo, row.cbte_nro)
      : null;

  return {
    estado: row.estado,
    comprobante,
    cbte_tipo: row.cbte_tipo,
    cbte_tipo_label: cbteTipoLabel(row.cbte_tipo),
    cbte_nro: row.cbte_nro,
    punto_venta: row.punto_venta,
    cae: row.cae,
    cae_vencimiento: row.cae_vencimiento,
    qr_url: row.qr_url,
    error_message: row.error_message,
    ambiente: row.ambiente,
  };
}
