import { ArcaWSFEError } from "@ramiidv/arca-facturacion";
import { getArcaConfig, isArcaConfigured } from "../../config/arca.js";
import { AppError } from "../../middleware/errors.js";
import { getArcaClient } from "./arca-client.js";
import { buildQrUrl, lineasToArcaItems } from "./mappers.js";
import { resolverComprobante } from "./resolver.js";
import {
  ensureComprobantePendiente,
  getComprobanteByVentaId,
  loadVentaFiscalContext,
  marcarComprobanteEmitido,
  marcarComprobanteError,
  rowToFiscalResponse,
} from "./repository.js";
import type { ComprobanteFiscalResponse } from "./types.js";

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

  const ctx = await loadVentaFiscalContext(ventaId);
  if (!ctx) {
    throw new AppError(404, "VENTA_NOT_FOUND", "Venta no encontrada");
  }

  const existing = await getComprobanteByVentaId(ventaId);
  if (existing?.estado === "emitido" && existing.cae) {
    return rowToFiscalResponse(existing);
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

  const resuelto = resolverComprobante(ctx.cliente);
  const items = lineasToArcaItems(ctx.lineas);

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

  try {
    const result = await arca.facturar({
      ptoVta: arcaConfig.ptoVta,
      cbteTipo: resuelto.cbteTipo,
      docTipo: resuelto.docTipo,
      docNro: resuelto.docNro,
      condicionIva: resuelto.condicionIva,
      items,
    });

    if (!result.aprobada || !result.cae || result.cbteNro == null) {
      const msg =
        result.observaciones?.map((o) => `[${o.code}] ${o.msg}`).join("; ") ??
        "ARCA rechazó el comprobante sin detalle";
      await marcarComprobanteError(ventaId, "ARCA_REJECTED", msg, result);
      const row = await getComprobanteByVentaId(ventaId);
      return rowToFiscalResponse(row!);
    }

    const fechaCbte = new Date().toISOString().slice(0, 10);
    const qrUrl = buildQrUrl(arca, {
      fecha: fechaCbte,
      cuit: arcaConfig.cuit,
      ptoVta: arcaConfig.ptoVta,
      cbteTipo: resuelto.cbteTipo,
      cbteNro: result.cbteNro,
      total: ctx.total,
      docTipo: resuelto.docTipo,
      docNro: resuelto.docNro,
      cae: result.cae,
    });

    const caeVenc = formatArcaDate(result.caeVencimiento ?? fechaCbte.replace(/-/g, ""));

    await marcarComprobanteEmitido(ventaId, {
      cbte_nro: result.cbteNro,
      fecha_cbte: fechaCbte,
      cae: result.cae,
      cae_vencimiento: caeVenc,
      qr_url: qrUrl,
      raw_response: result,
    });

    const row = await getComprobanteByVentaId(ventaId);
    return rowToFiscalResponse(row!);
  } catch (err) {
    const code = err instanceof ArcaWSFEError ? "ARCA_WSFE_ERROR" : "ARCA_ERROR";
    const message =
      err instanceof ArcaWSFEError
        ? err.errors.map((e) => `[${e.code}] ${e.msg}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Error desconocido al emitir comprobante";

    await marcarComprobanteError(ventaId, code, message, err);
    const row = await getComprobanteByVentaId(ventaId);
    return rowToFiscalResponse(row!);
  }
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
