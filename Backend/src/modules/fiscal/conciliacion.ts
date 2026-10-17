import { ArcaWSFEError, type FECompConsultarResult } from "@ramiidv/arca-facturacion";
import { pool } from "../../config/db.js";
import { env } from "../../config/env.js";
import { getArcaClient, type ArcaFiscalClient } from "./arca-client.js";
import {
  getComprobanteByVentaId,
  marcarComprobanteEmitido,
  resolverIntento,
  type ComprobanteRow,
  type Queryable,
} from "./repository.js";

const SWEEP_LOCK = 8421003;

function cents(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round(Number(value) * 100);
}

function ymd(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/-/g, "").slice(0, 8);
}

export async function conciliarComprobante(
  db: Queryable,
  row: ComprobanteRow,
  arca: ArcaFiscalClient,
): Promise<void> {
  if (!row.intento_nro_intento || row.intento_cbte_nro == null) return;
  const intento = await db.query<{
    id: number;
    cbte_nro: number;
    imp_total: string;
    doc_tipo: number;
    doc_nro: string;
    fecha_cbte: string;
    cbte_tipo: number;
    punto_venta: number;
  }>(
    `SELECT id, cbte_nro, imp_total, doc_tipo, doc_nro, fecha_cbte::text, cbte_tipo, punto_venta
     FROM pos_comprobantes_fiscales_intentos
     WHERE comprobante_id = $1 AND estado IN ('enviando', 'desconocido')
     ORDER BY id DESC LIMIT 1`,
    [row.id],
  );
  const open = intento.rows[0];
  if (!open) return;

  let consultado: FECompConsultarResult | null = null;
  try {
    consultado = await arca.consultarComprobante(open.cbte_tipo, open.punto_venta, open.cbte_nro);
  } catch (err) {
    if (err instanceof ArcaWSFEError && err.errors.some((item) => item.code === 602)) {
      consultado = { Errors: { Err: { Code: 602, Msg: "Comprobante inexistente" } } } as FECompConsultarResult;
    } else {
      return;
    }
  }

  const errCode = consultado.Errors
    ? (Array.isArray(consultado.Errors.Err) ? consultado.Errors.Err[0]?.Code : consultado.Errors.Err.Code)
    : undefined;
  const existe = Boolean(consultado.ResultGet?.CodAutorizacion) && errCode !== 602;

  if (existe && consultado.ResultGet) {
    const got = consultado.ResultGet;
    const coincide = cents(got.ImpTotal) === cents(Number(open.imp_total))
      && got.DocTipo === open.doc_tipo
      && Number(got.DocNro) === Number(open.doc_nro)
      && ymd(got.CbteFch) === ymd(open.fecha_cbte);
    if (!coincide) {
      console.error(JSON.stringify({
        level: "CRITICAL",
        msg: "CONFLICTO_NUMERACION",
        venta_id: row.venta_id,
        cbte_nro: open.cbte_nro,
      }));
      await resolverIntento(db, {
        intento_id: open.id,
        venta_id: row.venta_id,
        estado: "error",
        error_code: "CONFLICTO_NUMERACION",
        error_message: "El comprobante en ARCA no coincide con el intento local",
        response_raw: consultado,
      });
      return;
    }
    await marcarComprobanteEmitido(row.venta_id, {
      cbte_nro: open.cbte_nro,
      fecha_cbte: open.fecha_cbte.slice(0, 10),
      cae: got.CodAutorizacion,
      cae_vencimiento: got.FchVto ? `${got.FchVto.slice(0, 4)}-${got.FchVto.slice(4, 6)}-${got.FchVto.slice(6, 8)}` : null,
      qr_url: row.qr_url ?? "",
      raw_response: consultado,
      imp_total_enviado: Number(open.imp_total),
      intento_id: open.id,
    }, db as never);
    return;
  }

  let ultimo = 0;
  try {
    ultimo = await arca.ultimoComprobante(open.punto_venta, open.cbte_tipo);
  } catch {
    return;
  }
  if (ultimo < open.cbte_nro) {
    await resolverIntento(db, {
      intento_id: open.id,
      venta_id: row.venta_id,
      estado: "no_autorizado",
      error_code: "NO_AUTORIZADO",
      error_message: "ARCA no tiene el comprobante y el último número es anterior",
      response_raw: consultado,
    });
    return;
  }
  console.error(JSON.stringify({
    level: "CRITICAL",
    msg: "CONCILIACION_INCONSISTENTE",
    venta_id: row.venta_id,
    cbte_nro: open.cbte_nro,
    ultimo,
  }));
  await resolverIntento(db, {
    intento_id: open.id,
    venta_id: row.venta_id,
    estado: "error",
    error_code: "CONCILIACION_INCONSISTENTE",
    error_message: "No se pudo conciliar el número con ARCA",
    response_raw: consultado,
  });
}

export async function barridoConciliacion(opts?: { minAgeMs?: number }): Promise<number> {
  const client = await pool.connect();
  let locked = false;
  const ids: number[] = [];
  try {
    const got = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS locked`,
      [SWEEP_LOCK],
    );
    locked = got.rows[0]?.locked === true;
    if (!locked) return 0;
    const ageMs = opts?.minAgeMs ?? 120_000;
    const rows = await client.query<{ venta_id: number }>(
      `SELECT DISTINCT venta_id
       FROM pos_comprobantes_fiscales_intentos
       WHERE estado IN ('enviando', 'desconocido')
         AND created_at < NOW() - ($1::text || ' milliseconds')::interval
       ORDER BY venta_id
       LIMIT 20`,
      [String(ageMs)],
    );
    ids.push(...rows.rows.map((row) => row.venta_id));
  } finally {
    if (locked) {
      await client.query(`SELECT pg_advisory_unlock($1)`, [SWEEP_LOCK]);
    }
    client.release();
  }
  for (const ventaId of ids) {
    const { emitirComprobanteVenta } = await import("./service.js");
    await emitirComprobanteVenta(ventaId).catch((err) => {
      console.error(JSON.stringify({
        level: "error",
        msg: "barrido fiscal",
        venta_id: ventaId,
        error: err instanceof Error ? err.message : "error",
      }));
    });
  }
  return ids.length;
}

let timer: NodeJS.Timeout | null = null;

export function startConciliacionSweep(): void {
  if (timer) return;
  void barridoConciliacion().catch(() => undefined);
  timer = setInterval(() => {
    void barridoConciliacion().catch(() => undefined);
  }, env.FISCAL_CONCILIACION_INTERVAL_MS);
  timer.unref?.();
}

export function stopConciliacionSweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function arcaParaConciliar(): ArcaFiscalClient | null {
  return getArcaClient();
}
