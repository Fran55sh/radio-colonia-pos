import { getArcaConfig, isArcaConfigured } from "../../config/arca.js";
import { calcularImportesVenta, moneyFromCents } from "../../lib/fiscal-importes.js";
import { AppError } from "../../middleware/errors.js";
import { getArcaClient } from "./arca-client.js";
import type { DbClient } from "../../config/db.js";
import { cbteTipoPorCondicionIva } from "./cbte-tipo.js";
import { CONDICION_IVA_CF } from "./iva-condiciones.js";
import { buildFECAEDetRequest, buildQrUrl, parseFECAESolicitar } from "./mappers.js";
import { ArcaWSFEError, DocTipo } from "@ramiidv/arca-facturacion";
import { resolverComprobante } from "./resolver.js";
import {
  ensureComprobantePendiente,
  getComprobanteByVentaId,
  loadVentaFiscalContext,
  marcarComprobanteEmitido,
  marcarComprobanteError,
  reservarIntento,
  resolverIntento,
  rowToFiscalResponse,
  withVentaFiscalLock,
  type FiscalSession,
  type Queryable,
} from "./repository.js";
import { conciliarComprobante } from "./conciliacion.js";
import { ArcaAuthError, ArcaSoapError } from "@ramiidv/arca-facturacion";
import type { ComprobanteFiscalResponse } from "./types.js";

import { hoyAR, toCbteFch } from "../../lib/fecha-ar.js";

function formatArcaDate(value: string): string {
  if (value.includes("-")) return value.slice(0, 10);
  if (value.length === 8) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  return value;
}

export async function getFiscalStatus(ventaId: number): Promise<ComprobanteFiscalResponse | null> {
  const row = await getComprobanteByVentaId(ventaId);
  return row ? rowToFiscalResponse(row) : null;
}

export async function emitirComprobanteVenta(
  ventaId: number,
  options?: { forceRetry?: boolean },
): Promise<ComprobanteFiscalResponse | null> {
  const arcaConfig = getArcaConfig();
  if (!arcaConfig?.enabled) return null;

  return withVentaFiscalLock(ventaId, async (session) => {
    const db = session?.client;
    const ctx = await loadVentaFiscalContext(ventaId, db);
    if (!ctx) {
      throw new AppError(404, "VENTA_NOT_FOUND", "Venta no encontrada");
    }

    let existing = await getComprobanteByVentaId(ventaId, db);
    if (existing?.cae) {
      return { ...rowToFiscalResponse(existing), estado: "emitido" as const };
    }
    if (existing && (existing.estado === "enviando" || existing.estado === "desconocido")) {
      const arca = getArcaClient();
      if (arca && session) {
        await session.lockPv(existing.ambiente, existing.punto_venta, existing.cbte_tipo);
        await conciliarComprobante(session.client, existing, arca);
      }
      existing = await getComprobanteByVentaId(ventaId, db);
      if (existing?.cae || existing?.estado === "emitido") {
        return { ...rowToFiscalResponse(existing!), estado: "emitido" as const };
      }
      if (existing && (existing.estado === "enviando" || existing.estado === "desconocido")) {
        return rowToFiscalResponse(existing);
      }
    }
    if (existing?.estado === "error" && !options?.forceRetry) {
      return rowToFiscalResponse(existing);
    }
    if (existing?.estado === "rechazado" && !options?.forceRetry) {
      return rowToFiscalResponse(existing);
    }

    return await ejecutarEmision(ventaId, ctx, arcaConfig, session);
  });
}

/** Persiste el trabajo fiscal en la misma transacción que registra la venta.
 * No llama a ARCA. skipFiscal sólo difiere el envío, no esta obligación.
 */
export async function registrarPendienteVenta(ventaId: number, db: DbClient): Promise<void> {
  const config = getArcaConfig();
  if (!config?.enabled) return;
  const ctx = await loadVentaFiscalContext(ventaId, db);
  if (!ctx) throw new AppError(404, "VENTA_NOT_FOUND", "Venta no encontrada");
  await prepararComprobante(ventaId, ctx, config, db);
}

async function prepararComprobante(
  ventaId: number,
  ctx: NonNullable<Awaited<ReturnType<typeof loadVentaFiscalContext>>>,
  arcaConfig: NonNullable<ReturnType<typeof getArcaConfig>>,
  db?: Queryable,
) {
  let resuelto;
  try {
    resuelto = resolverComprobante(ctx.cliente);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    const condicion = ctx.cliente?.condicion_iva_receptor_id ?? CONDICION_IVA_CF;
    await ensureComprobantePendiente(ventaId, {
      ambiente: arcaConfig.ambiente,
      emisor_cuit: String(arcaConfig.cuit),
      punto_venta: arcaConfig.ptoVta,
      cbte_tipo: cbteTipoPorCondicionIva(condicion),
      doc_tipo: DocTipo.CUIT,
      doc_nro: 0,
      condicion_iva_receptor_id: condicion,
      neto_gravado: ctx.neto_gravado,
      iva_total: ctx.iva_total,
      exento: ctx.exento,
      total: ctx.total,
    }, db);
    await marcarComprobanteError(ventaId, err.code, err.message, err, db);
    const row = await getComprobanteByVentaId(ventaId, db);
    return { pendiente: row!, resuelto: null };
  }

  const pendiente = await ensureComprobantePendiente(ventaId, {
    ambiente: arcaConfig.ambiente,
    emisor_cuit: String(arcaConfig.cuit),
    punto_venta: arcaConfig.ptoVta,
    cbte_tipo: resuelto.cbteTipo,
    doc_tipo: resuelto.docTipo,
    doc_nro: resuelto.docNro,
    condicion_iva_receptor_id: resuelto.condicionIva,
    neto_gravado: ctx.neto_gravado,
    iva_total: ctx.iva_total,
    exento: ctx.exento,
    total: ctx.total,
  }, db);

  return { pendiente, resuelto };
}

async function ejecutarEmision(
  ventaId: number,
  ctx: NonNullable<Awaited<ReturnType<typeof loadVentaFiscalContext>>>,
  arcaConfig: NonNullable<ReturnType<typeof getArcaConfig>>,
  session?: FiscalSession,
): Promise<ComprobanteFiscalResponse> {
  const arca = getArcaClient();
  if (!arca) {
    throw new AppError(
      503,
      "ARCA_NOT_CONFIGURED",
      "Facturación ARCA habilitada pero faltan certificados o configuración",
    );
  }
  const db = session?.client;
  const { pendiente, resuelto } = await prepararComprobante(ventaId, ctx, arcaConfig, db);
  if (!resuelto) return rowToFiscalResponse(pendiente);

  let importes;
  try {
    importes = calcularImportesVenta(
      ctx.lineas.map((linea) => ({
        orden: linea.orden,
        cantidad: linea.cantidad,
        precio_unitario: linea.precio_unitario,
        alicuota: linea.alicuota_iva,
      })),
    );
    if (importes.total_cents !== Math.round(ctx.total * 100) || importes.total_cents <= 0) {
      throw new AppError(
        409,
        "IMPORTES_INCONSISTENTES",
        "Los importes de las líneas no cierran con el total de la venta",
      );
    }
  } catch (err) {
    return await marcarFallaPrevia(ventaId, err, db);
  }

  const fechaCbte = hoyAR();
  const detail = buildFECAEDetRequest({
    cbteNro: 0,
    cbteFch: toCbteFch(),
    docTipo: resuelto.docTipo,
    docNro: resuelto.docNro,
    condicionIva: resuelto.condicionIva,
    importes,
  });

  let intentoId: number | null = null;
  let raw;
  try {
    await session?.lockPv(arcaConfig.ambiente, arcaConfig.ptoVta, resuelto.cbteTipo);
    const ultimo = await arca.ultimoComprobante(arcaConfig.ptoVta, resuelto.cbteTipo);
    const local = db
      ? await db.query<{ n: number }>(
          `SELECT COALESCE(MAX(cbte_nro), 0)::int AS n
           FROM pos_comprobantes_fiscales_intentos
           WHERE ambiente = $1 AND punto_venta = $2 AND cbte_tipo = $3
             AND cbte_nro IS NOT NULL
             AND estado IN ('enviando', 'desconocido', 'emitido')`,
          [arcaConfig.ambiente, arcaConfig.ptoVta, resuelto.cbteTipo],
        )
      : { rows: [{ n: 0 }] };
    const nro = Math.max(ultimo, local.rows[0]?.n ?? 0) + 1;
    detail.CbteDesde = nro;
    detail.CbteHasta = nro;
    const impTotal = moneyFromCents(importes.total_cents);
    if (db && pendiente.id) {
      const reserved = await reservarIntento(db, {
        comprobante_id: pendiente.id,
        venta_id: ventaId,
        ambiente: arcaConfig.ambiente,
        emisor_cuit: String(arcaConfig.cuit),
        punto_venta: arcaConfig.ptoVta,
        cbte_tipo: resuelto.cbteTipo,
        cbte_nro: nro,
        fecha_cbte: fechaCbte,
        doc_tipo: resuelto.docTipo,
        doc_nro: resuelto.docNro,
        condicion_iva_receptor_id: resuelto.condicionIva,
        imp_total: impTotal,
        imp_neto: moneyFromCents(importes.neto_cents),
        imp_iva: moneyFromCents(importes.iva_cents),
        imp_op_ex: moneyFromCents(importes.exento_cents),
        iva_detalle: detail.Iva ?? [],
        request_payload: detail,
      });
      intentoId = reserved.id;
    }
    raw = await arca.crearFactura({
      PtoVta: arcaConfig.ptoVta,
      CbteTipo: resuelto.cbteTipo,
      invoices: [detail],
    });
  } catch (err) {
    if (intentoId && db) {
      const estado = clasificarFalloEnvio(err);
      await resolverIntento(db, {
        intento_id: intentoId,
        venta_id: ventaId,
        estado,
        error_code: err instanceof ArcaWSFEError ? "ARCA_WSFE_ERROR" : estado === "desconocido" ? "ARCA_DESCONOCIDO" : "ARCA_ERROR",
        error_message: mensajeError(err),
        response_raw: err,
      });
      const row = await getComprobanteByVentaId(ventaId, db);
      if (row?.cae) return { ...rowToFiscalResponse(row), estado: "emitido" };
      if (row) return rowToFiscalResponse(row);
    }
    return await marcarFallaPrevia(ventaId, err, db);
  }

  const parsed = parseFECAESolicitar(raw);
  if (!parsed.aprobada || !parsed.cae || !parsed.cbteNro) {
    const msg =
      parsed.observaciones.map((o) => `[${o.code}] ${o.msg}`).join("; ") ||
      "ARCA rechazó el comprobante sin detalle";
    if (intentoId && db) {
      await resolverIntento(db, {
        intento_id: intentoId,
        venta_id: ventaId,
        estado: "rechazado",
        error_code: "ARCA_REJECTED",
        error_message: msg,
        response_raw: raw,
      });
    } else {
      await marcarComprobanteError(ventaId, "ARCA_REJECTED", msg, raw, db);
    }
    const row = await getComprobanteByVentaId(ventaId, db);
    return rowToFiscalResponse(row!);
  }

  const impTotal = moneyFromCents(importes.total_cents);
  const qrUrl = buildQrUrl(arca, {
    fecha: fechaCbte,
    cuit: arcaConfig.cuit,
    ptoVta: arcaConfig.ptoVta,
    cbteTipo: resuelto.cbteTipo,
    cbteNro: parsed.cbteNro,
    total: impTotal,
    docTipo: resuelto.docTipo,
    docNro: resuelto.docNro,
    cae: parsed.cae,
  });

  const caeVenc = formatArcaDate(parsed.caeVencimiento ?? "");
  const persisted = await persistirEmitido(ventaId, {
    cbte_nro: parsed.cbteNro,
    fecha_cbte: fechaCbte,
    cae: parsed.cae,
    cae_vencimiento: caeVenc || null,
    qr_url: qrUrl,
    raw_response: raw,
    iva_detalle: detail.Iva ?? [],
    imp_total_enviado: impTotal,
    intento_id: intentoId,
  }, db);

  if (persisted) {
    const row = await getComprobanteByVentaId(ventaId, db);
    if (row?.cae) return { ...rowToFiscalResponse(row), estado: "emitido" };
  }
  const pendienteRow = await getComprobanteByVentaId(ventaId, db);
  if (pendienteRow?.cae) return { ...rowToFiscalResponse(pendienteRow), estado: "emitido" };
  if (pendienteRow) return rowToFiscalResponse(pendienteRow);
  return {
    estado: "enviando",
    comprobante: null,
    cbte_tipo: resuelto.cbteTipo,
    cbte_tipo_label: "",
    cbte_nro: parsed.cbteNro,
    punto_venta: arcaConfig.ptoVta,
    cae: null,
    cae_vencimiento: null,
    qr_url: null,
    error_message: null,
    ambiente: arcaConfig.ambiente,
    puede_reintentar: false,
    requiere_conciliacion: true,
    imp_total_enviado: impTotal,
    intento: null,
  };
}

function clasificarFalloEnvio(err: unknown): "error" | "rechazado" | "desconocido" {
  if (err instanceof ArcaAuthError) return "error";
  if (err instanceof ArcaWSFEError) return "rechazado";
  if (err instanceof ArcaSoapError) return "desconocido";
  if (err instanceof Error && (err.name === "AbortError" || /timeout|network|fetch|ECONN|ENOTFOUND|5\d\d/i.test(err.message))) {
    return "desconocido";
  }
  return "desconocido";
}

function mensajeError(err: unknown): string {
  if (err instanceof ArcaWSFEError) return err.errors.map((item) => `[${item.code}] ${item.msg}`).join("; ");
  return err instanceof Error ? err.message : "Error desconocido al emitir comprobante";
}

async function marcarFallaPrevia(
  ventaId: number,
  err: unknown,
  db?: FiscalSession["client"],
): Promise<ComprobanteFiscalResponse> {
  const code = err instanceof ArcaWSFEError
    ? "ARCA_WSFE_ERROR"
    : err instanceof AppError
      ? err.code
      : "ARCA_ERROR";
  const message = mensajeError(err);
  await marcarComprobanteError(ventaId, code, message, err, db);
  const row = await getComprobanteByVentaId(ventaId, db);
  if (row?.cae) return { ...rowToFiscalResponse(row), estado: "emitido" };
  return rowToFiscalResponse(row!);
}

let persistFailuresLeft = 0;

export function setPersistFailuresForTests(count: number): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("setPersistFailuresForTests solo se usa con NODE_ENV=test");
  }
  persistFailuresLeft = count;
}

async function persistirEmitido(
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
  db?: FiscalSession["client"],
): Promise<boolean> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (persistFailuresLeft > 0) {
        persistFailuresLeft -= 1;
        throw new Error("persistencia fiscal simulada");
      }
      await marcarComprobanteEmitido(ventaId, data, db as never);
      return true;
    } catch (err) {
      last = err;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 40 * attempt));
      }
    }
  }
  console.error(
    JSON.stringify({
      level: "CRITICAL",
      msg: "CAE obtenido y persistencia fallida",
      venta_id: ventaId,
      cbte_nro: data.cbte_nro,
      cae: data.cae,
      error: last instanceof Error ? last.message : "error de persistencia",
    }),
  );
  return false;
}

export async function maybeEmitirDespuesDeVenta(
  ventaId: number,
  opts?: { skipFiscal?: boolean },
): Promise<ComprobanteFiscalResponse | null> {
  if (opts?.skipFiscal || !isArcaConfigured()) return null;
  return emitirComprobanteVenta(ventaId);
}

export async function reintentarComprobante(ventaId: number): Promise<ComprobanteFiscalResponse | null> {
  if (!isArcaConfigured()) {
    throw new AppError(503, "ARCA_DISABLED", "Facturación ARCA no está habilitada");
  }
  return emitirComprobanteVenta(ventaId, { forceRetry: true });
}
