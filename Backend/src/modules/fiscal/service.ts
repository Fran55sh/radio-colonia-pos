import { getArcaConfig, isArcaConfigured } from "../../config/arca.js";
import { calcularImportesVenta, moneyFromCents } from "../../lib/fiscal-importes.js";
import { AppError } from "../../middleware/errors.js";
import { getArcaClient } from "./arca-client.js";
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
  rowToFiscalResponse,
  withVentaFiscalLock,
} from "./repository.js";
import type { ComprobanteFiscalResponse } from "./types.js";

function fechaHoyAR(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

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

  return withVentaFiscalLock(ventaId, async () => {
    const ctx = await loadVentaFiscalContext(ventaId);
    if (!ctx) {
      throw new AppError(404, "VENTA_NOT_FOUND", "Venta no encontrada");
    }

    // Re-check under lock so concurrent retries cannot double-call WSFE.
    const existing = await getComprobanteByVentaId(ventaId);
    if (existing?.cae) {
      return { ...rowToFiscalResponse(existing), estado: "emitido" };
    }
    if (existing?.estado === "pendiente" && !options?.forceRetry) {
      return await ejecutarEmision(ventaId, ctx, arcaConfig);
    }
    if (existing?.estado === "error" && options?.forceRetry) {
      return await ejecutarEmision(ventaId, ctx, arcaConfig);
    }
    if (existing?.estado === "error" && !options?.forceRetry) {
      return rowToFiscalResponse(existing);
    }

    return await ejecutarEmision(ventaId, ctx, arcaConfig);
  });
}

async function ejecutarEmision(
  ventaId: number,
  ctx: NonNullable<Awaited<ReturnType<typeof loadVentaFiscalContext>>>,
  arcaConfig: NonNullable<ReturnType<typeof getArcaConfig>>,
): Promise<ComprobanteFiscalResponse> {
  const arca = getArcaClient();
  if (!arca) {
    throw new AppError(
      503,
      "ARCA_NOT_CONFIGURED",
      "Facturación ARCA habilitada pero faltan certificados o configuración",
    );
  }

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
    });
    await marcarComprobanteError(ventaId, err.code, err.message, err);
    const row = await getComprobanteByVentaId(ventaId);
    return rowToFiscalResponse(row!);
  }

  await ensureComprobantePendiente(ventaId, {
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
  });

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
    return await marcarFallaPrevia(ventaId, err);
  }

  const fechaCbte = fechaHoyAR();
  const detail = buildFECAEDetRequest({
    cbteNro: 0,
    cbteFch: fechaCbte.replace(/-/g, ""),
    docTipo: resuelto.docTipo,
    docNro: resuelto.docNro,
    condicionIva: resuelto.condicionIva,
    importes,
  });

  let raw;
  try {
    const ultimo = await arca.ultimoComprobante(arcaConfig.ptoVta, resuelto.cbteTipo);
    detail.CbteDesde = ultimo + 1;
    detail.CbteHasta = ultimo + 1;
    raw = await arca.crearFactura({
      PtoVta: arcaConfig.ptoVta,
      CbteTipo: resuelto.cbteTipo,
      invoices: [detail],
    });
  } catch (err) {
    return await marcarFallaPrevia(ventaId, err);
  }

  const parsed = parseFECAESolicitar(raw);
  if (!parsed.aprobada || !parsed.cae || !parsed.cbteNro) {
    const msg =
      parsed.observaciones.map((o) => `[${o.code}] ${o.msg}`).join("; ") ||
      "ARCA rechazó el comprobante sin detalle";
    await marcarComprobanteError(ventaId, "ARCA_REJECTED", msg, raw);
    const row = await getComprobanteByVentaId(ventaId);
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
  });

  if (persisted) {
    const row = await getComprobanteByVentaId(ventaId);
    if (row?.cae) return { ...rowToFiscalResponse(row), estado: "emitido" };
  }

  return {
    estado: "emitido",
    comprobante: null,
    cbte_tipo: resuelto.cbteTipo,
    cbte_tipo_label: "",
    cbte_nro: parsed.cbteNro,
    punto_venta: arcaConfig.ptoVta,
    cae: parsed.cae,
    cae_vencimiento: caeVenc || null,
    qr_url: qrUrl,
    error_message: null,
    ambiente: arcaConfig.ambiente,
  };
}

async function marcarFallaPrevia(
  ventaId: number,
  err: unknown,
): Promise<ComprobanteFiscalResponse> {
  const code = err instanceof ArcaWSFEError
    ? "ARCA_WSFE_ERROR"
    : err instanceof AppError
      ? err.code
      : "ARCA_ERROR";
  const message = err instanceof ArcaWSFEError
    ? err.errors.map((e) => `[${e.code}] ${e.msg}`).join("; ")
    : err instanceof Error
      ? err.message
      : "Error desconocido al emitir comprobante";
  await marcarComprobanteError(ventaId, code, message, err);
  const row = await getComprobanteByVentaId(ventaId);
  if (row?.cae) return { ...rowToFiscalResponse(row), estado: "emitido" };
  return rowToFiscalResponse(row!);
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
  },
): Promise<boolean> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await marcarComprobanteEmitido(ventaId, {
        ...data,
        cae_vencimiento: data.cae_vencimiento,
      });
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
