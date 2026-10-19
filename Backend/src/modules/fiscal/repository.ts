import { pool, withTransaction, type DbClient } from "../../config/db.js";
import { env } from "../../config/env.js";
import type { ClienteFiscal, ComprobanteFiscalResponse, FiscalEstado, LineaFiscal } from "./types.js";
import { cbteTipoLabel, formatComprobanteNumero } from "./mappers.js";
import { puedeReintentar, requiereConciliacion } from "./estado.js";

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
  imp_total_enviado?: number | null;
  intento_actual_id?: number | null;
  intento_nro_intento?: number | null;
  intento_estado?: string | null;
  intento_cbte_nro?: number | null;
};

export async function loadVentaFiscalContext(ventaId: number, db: Queryable = pool): Promise<{
  venta_id: number;
  cliente_id: number | null;
  neto_gravado: number;
  iva_total: number;
  exento: number;
  total: number;
  lineas: LineaFiscal[];
  cliente: ClienteFiscal | null;
} | null> {
  const ventaRes = await db.query<{
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
  const lineasRes = await db.query<{
    cantidad: string;
    precio_unitario: string;
    neto_linea: string;
    iva_linea: string;
    exento_linea: string;
    alicuota_iva: string;
  }>(
    `SELECT cantidad, precio_unitario, neto_linea, iva_linea, exento_linea, alicuota_iva
     FROM pos_lineas_venta WHERE venta_id = $1
     ORDER BY id`,
    [ventaId],
  );

  let cliente: ClienteFiscal | null = null;
  if (v.cliente_id) {
    const cRes = await db.query<ClienteFiscal>(
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
    lineas: lineasRes.rows.map((l, index) => ({
      orden: index,
      cantidad: Number(l.cantidad),
      precio_unitario: Number(l.precio_unitario),
      neto_linea: Number(l.neto_linea),
      iva_linea: Number(l.iva_linea),
      exento_linea: Number(l.exento_linea),
      alicuota_iva: Number(l.alicuota_iva),
    })),
    cliente,
  };
}

export async function getComprobanteByVentaId(
  ventaId: number,
  db: Queryable = pool,
): Promise<ComprobanteRow | null> {
  const { rows } = await db.query<ComprobanteRow>(
    `SELECT c.id, c.venta_id, c.estado, c.ambiente, c.emisor_cuit, c.punto_venta, c.cbte_tipo,
            c.cbte_nro, c.fecha_cbte::text, c.cae, c.cae_vencimiento::text, c.qr_url, c.error_message,
            c.imp_total_enviado, c.intento_actual_id,
            i.nro_intento AS intento_nro_intento,
            i.estado AS intento_estado,
            i.cbte_nro AS intento_cbte_nro
     FROM pos_comprobantes_fiscales c
     LEFT JOIN pos_comprobantes_fiscales_intentos i ON i.id = c.intento_actual_id
     WHERE c.venta_id = $1`,
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
  db: Queryable = pool,
): Promise<ComprobanteRow> {
  await db.query(
    `INSERT INTO pos_comprobantes_fiscales (
      venta_id, estado, ambiente, emisor_cuit, punto_venta, cbte_tipo,
      doc_tipo, doc_nro, condicion_iva_receptor_id,
      neto_gravado, iva_total, exento, total
    ) VALUES ($1, 'pendiente', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (venta_id) DO UPDATE SET
      cbte_tipo = EXCLUDED.cbte_tipo,
      doc_tipo = EXCLUDED.doc_tipo,
      doc_nro = EXCLUDED.doc_nro,
      condicion_iva_receptor_id = EXCLUDED.condicion_iva_receptor_id,
      neto_gravado = EXCLUDED.neto_gravado,
      iva_total = EXCLUDED.iva_total,
      exento = EXCLUDED.exento,
      total = EXCLUDED.total,
      estado = 'pendiente',
      error_code = NULL,
      error_message = NULL,
      updated_at = NOW()
    WHERE pos_comprobantes_fiscales.estado IN ('pendiente', 'error')`,
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

  const row = await getComprobanteByVentaId(ventaId, db);
  if (!row) {
    throw new Error(`No se pudo crear/leer comprobante fiscal para venta ${ventaId}`);
  }
  return row;
}

export class FiscalLockBusy extends Error {
  constructor() {
    super("No se pudo tomar el lock fiscal");
    this.name = "FiscalLockBusy";
  }
}

export type Queryable = Pick<DbClient, "query">;

/** Transacción corta sobre la conexión que ya posee los locks fiscales. */
async function withFiscalTransaction<T>(db: Queryable, run: () => Promise<T>): Promise<T> {
  await db.query("BEGIN");
  try {
    const result = await run();
    await db.query("COMMIT");
    return result;
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

export type FiscalSession = {
  client: Queryable;
  lockPv: (ambiente: string, puntoVenta: number, cbteTipo: number) => Promise<void>;
};

const LOCK_VENTA = 8421001;
const LOCK_PV = 8421002;

export function pvLockKey(ambiente: string, puntoVenta: number, cbteTipo: number): number {
  const base = ambiente === "prod" ? 1_000_000_000 : 0;
  return base + puntoVenta * 1000 + cbteTipo;
}

/** Una conexión toma los locks y hace todas las escrituras fiscales. ARCA queda afuera de cualquier TX. */
export async function withVentaFiscalLock<T>(
  ventaId: number,
  fn: (session?: FiscalSession) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let pvKey: number | null = null;
  try {
    await client.query(`SELECT set_config('lock_timeout', $1, false)`, [
      `${env.FISCAL_LOCK_TIMEOUT_MS}ms`,
    ]);
    await client.query(`SELECT pg_advisory_lock($1, $2)`, [LOCK_VENTA, ventaId]);
    const session: FiscalSession = {
      client,
      lockPv: async (ambiente, puntoVenta, cbteTipo) => {
        const key = pvLockKey(ambiente, puntoVenta, cbteTipo);
        if (pvKey === key) return;
        if (pvKey != null) {
          throw new Error("El lock de numeración ya está tomado para otro comprobante");
        }
        await client.query(`SELECT pg_advisory_lock($1, $2)`, [LOCK_PV, key]);
        pvKey = key;
      },
    };
    return await fn(session);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code === "55P03") throw new FiscalLockBusy();
    throw err;
  } finally {
    try {
      if (pvKey != null) {
        await client.query(`SELECT pg_advisory_unlock($1, $2)`, [LOCK_PV, pvKey]);
      }
      await client.query(`SELECT pg_advisory_unlock($1, $2)`, [LOCK_VENTA, ventaId]);
    } catch {
      // La conexión se descarta igual.
    }
    try {
      await client.query(`SELECT set_config('lock_timeout', '0', false)`);
    } catch {
      // Si la sesión quedó abortada, el pool la recicla al liberarla.
    }
    client.release();
  }
}

export async function marcarComprobanteEmitido(
  ventaId: number,
  data: {
    cbte_nro: number;
    fecha_cbte: string;
    cae: string;
    cae_vencimiento: string | null;
    qr_url: string;
    raw_response: unknown;
    iva_detalle?: unknown;
    imp_total_enviado?: number | null;
    intento_id?: number | null;
  },
  db?: DbClient,
): Promise<void> {
  const run = async (client: Queryable) => {
    if (data.intento_id) {
      await client.query(
        `UPDATE pos_comprobantes_fiscales_intentos SET
           estado = 'emitido',
           cae = $2,
           cae_vencimiento = $3::date,
           response_raw = $4::jsonb,
           resolved_at = NOW()
         WHERE id = $1 AND estado IN ('enviando', 'desconocido')`,
        [
          data.intento_id,
          data.cae,
          data.cae_vencimiento,
          JSON.stringify(data.raw_response),
        ],
      );
    }
    await client.query(
      `UPDATE pos_comprobantes_fiscales SET
        estado = 'emitido',
        cbte_nro = $2,
        fecha_cbte = $3::date,
        cae = $4,
        cae_vencimiento = $5::date,
        qr_url = $6,
        raw_response = $7,
        iva_detalle = COALESCE($8::jsonb, iva_detalle),
        imp_total_enviado = COALESCE($9, imp_total_enviado),
        intento_actual_id = COALESCE($10, intento_actual_id),
        error_code = NULL,
        error_message = NULL,
        updated_at = NOW()
       WHERE venta_id = $1 AND cae IS NULL`,
      [
        ventaId,
        data.cbte_nro,
        data.fecha_cbte,
        data.cae,
        data.cae_vencimiento,
        data.qr_url,
        JSON.stringify(data.raw_response),
        data.iva_detalle == null ? null : JSON.stringify(data.iva_detalle),
        data.imp_total_enviado ?? null,
        data.intento_id ?? null,
      ],
    );

    const comp = await client.query<ComprobanteRow>(
      `SELECT punto_venta, cbte_tipo, cbte_nro
       FROM pos_comprobantes_fiscales WHERE venta_id = $1`,
      [ventaId],
    );
    const row = comp.rows[0];
    if (row?.cbte_nro) {
      const comprobanteStr = formatComprobanteNumero(
        row.punto_venta,
        row.cbte_tipo,
        row.cbte_nro,
      );
      await client.query(
        `UPDATE pos_iva_registro SET comprobante = $2, fecha_fiscal = $3::date
         WHERE referencia_tipo = 'pos_venta' AND referencia_id = $1`,
        [ventaId, comprobanteStr, data.fecha_cbte],
      );
    }
  };

  if (!db) {
    await withTransaction(run);
    return;
  }
  await db.query("BEGIN");
  try {
    await run(db);
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

export async function marcarComprobanteError(
  ventaId: number,
  errorCode: string,
  errorMessage: string,
  raw?: unknown,
  db: Queryable = pool,
): Promise<void> {
  await db.query(
    `UPDATE pos_comprobantes_fiscales SET
      estado = 'error',
      error_code = $2,
      error_message = $3,
      raw_response = $4,
      updated_at = NOW()
     WHERE venta_id = $1 AND cae IS NULL AND estado <> 'emitido'`,
    [ventaId, errorCode, errorMessage, raw ? JSON.stringify(raw) : null],
  );
}

export async function reservarIntento(
  db: Queryable,
  data: {
    comprobante_id: number;
    venta_id: number;
    ambiente: string;
    emisor_cuit: string;
    punto_venta: number;
    cbte_tipo: number;
    cbte_nro: number;
    fecha_cbte: string;
    doc_tipo: number;
    doc_nro: number;
    condicion_iva_receptor_id: number;
    imp_total: number;
    imp_neto: number;
    imp_iva: number;
    imp_op_ex: number;
    iva_detalle: unknown;
    request_payload: unknown;
  },
): Promise<{ id: number; nro_intento: number }> {
  return withFiscalTransaction(db, async () => {
    const seq = await db.query<{ n: number }>(
      `SELECT COALESCE(MAX(nro_intento), 0) + 1 AS n
       FROM pos_comprobantes_fiscales_intentos WHERE comprobante_id = $1`,
      [data.comprobante_id],
    );
    const nroIntento = seq.rows[0]?.n ?? 1;
    const inserted = await db.query<{ id: number; nro_intento: number }>(
      `INSERT INTO pos_comprobantes_fiscales_intentos (
         comprobante_id, venta_id, nro_intento, estado, ambiente, emisor_cuit, punto_venta, cbte_tipo,
         cbte_nro, fecha_cbte, doc_tipo, doc_nro, condicion_iva_receptor_id,
         imp_total, imp_neto, imp_iva, imp_op_ex, iva_detalle, request_payload, sent_at
       ) VALUES (
         $1, $2, $3, 'enviando', $4, $5, $6, $7,
         $8, $9::date, $10, $11, $12,
         $13, $14, $15, $16, $17::jsonb, $18::jsonb, NOW()
       ) RETURNING id, nro_intento`,
      [
        data.comprobante_id,
        data.venta_id,
        nroIntento,
        data.ambiente,
        data.emisor_cuit,
        data.punto_venta,
        data.cbte_tipo,
        data.cbte_nro,
        data.fecha_cbte,
        data.doc_tipo,
        data.doc_nro,
        data.condicion_iva_receptor_id,
        data.imp_total,
        data.imp_neto,
        data.imp_iva,
        data.imp_op_ex,
        JSON.stringify(data.iva_detalle),
        JSON.stringify(data.request_payload),
      ],
    );
    const updated = await db.query(
      `UPDATE pos_comprobantes_fiscales SET
         estado = 'enviando',
         intento_actual_id = $2,
         cbte_tipo = $3,
         doc_tipo = $4,
         doc_nro = $5,
         condicion_iva_receptor_id = $6,
         updated_at = NOW()
       WHERE id = $1 AND cae IS NULL AND estado = ANY($7::text[])`,
      [
        data.comprobante_id,
        inserted.rows[0].id,
        data.cbte_tipo,
        data.doc_tipo,
        data.doc_nro,
        data.condicion_iva_receptor_id,
        ["pendiente", "rechazado", "error"],
      ],
    );
    if ((updated.rowCount ?? 0) === 0) {
      throw new Error("No se pudo marcar el comprobante como enviando");
    }
    return inserted.rows[0];
  });
}

export async function resolverIntento(
  db: Queryable,
  data: {
    intento_id: number;
    venta_id: number;
    estado: "emitido" | "rechazado" | "desconocido" | "error" | "no_autorizado";
    cae?: string | null;
    cae_vencimiento?: string | null;
    error_code?: string | null;
    error_message?: string | null;
    response_raw?: unknown;
  },
): Promise<void> {
  const intentoEstado = data.estado === "no_autorizado" ? "no_autorizado" : data.estado;
  const comprobanteEstado = intentoEstado === "no_autorizado" ? "rechazado" : data.estado;
  await withFiscalTransaction(db, async () => {
    await db.query(
      `UPDATE pos_comprobantes_fiscales_intentos SET
         estado = $2::varchar,
         cae = COALESCE($3, cae),
         cae_vencimiento = COALESCE($4::date, cae_vencimiento),
         error_code = $5,
         error_message = $6,
         response_raw = COALESCE($7::jsonb, response_raw),
         resolved_at = CASE WHEN $2::text IN ('enviando', 'desconocido') THEN resolved_at ELSE NOW() END
       WHERE id = $1 AND estado IN ('enviando', 'desconocido')`,
      [
        data.intento_id,
        intentoEstado,
        data.cae ?? null,
        data.cae_vencimiento ?? null,
        data.error_code ?? null,
        data.error_message ?? null,
        data.response_raw == null ? null : JSON.stringify(data.response_raw),
      ],
    );
    if (comprobanteEstado === "emitido") return;
    await db.query(
      `UPDATE pos_comprobantes_fiscales SET
         estado = $2::varchar,
         error_code = $3,
         error_message = $4,
         updated_at = NOW()
       WHERE venta_id = $1 AND cae IS NULL AND estado <> 'emitido'`,
      [data.venta_id, comprobanteEstado, data.error_code ?? null, data.error_message ?? null],
    );
  });
}

export async function listarPendientesFiscales(): Promise<Array<ComprobanteFiscalResponse & { venta_id: number }>> {
  const { rows } = await pool.query<ComprobanteRow>(
    `SELECT c.id, c.venta_id, c.estado, c.ambiente, c.emisor_cuit, c.punto_venta, c.cbte_tipo,
            c.cbte_nro, c.fecha_cbte::text, c.cae, c.cae_vencimiento::text, c.qr_url, c.error_message,
            c.imp_total_enviado
     FROM pos_comprobantes_fiscales c
     WHERE c.estado IN ('pendiente', 'enviando', 'desconocido', 'rechazado', 'error')
     ORDER BY c.updated_at DESC
     LIMIT 50`,
  );
  return rows.map((row) => ({ venta_id: row.venta_id, ...rowToFiscalResponse(row) }));
}

export function rowToFiscalResponse(row: ComprobanteRow): ComprobanteFiscalResponse {
  const comprobante =
    row.cbte_nro != null
      ? formatComprobanteNumero(row.punto_venta, row.cbte_tipo, row.cbte_nro)
      : null;

  return {
    estado: row.cae ? "emitido" : row.estado,
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
    puede_reintentar: puedeReintentar(row.estado, row.cae),
    requiere_conciliacion: requiereConciliacion(row.estado) && !row.cae,
    imp_total_enviado: row.imp_total_enviado ?? null,
    intento: row.intento_nro_intento == null
      ? null
      : {
          nro_intento: row.intento_nro_intento,
          estado: row.intento_estado ?? "",
          cbte_nro: row.intento_cbte_nro ?? null,
        },
  };
}
