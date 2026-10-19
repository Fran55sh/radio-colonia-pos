import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../../middleware/errors.js";
import {
  aplicarPlantilla,
  emailFacturaSchema,
  enviarFacturaEmail,
  enmascararEmail,
  leerEmailConfig,
} from "./distribucion/email.js";
import { crearEnlaceToken, secretoEnlace, ttlEnlaceSegundos, verificarEnlaceToken } from "./distribucion/enlace.js";
import { registrarDistribucion } from "./distribucion/registro.js";
import { cargarFacturaPersistida } from "./factura-datos.js";
import { esComprobanteAutorizado } from "./representacion/autorizado.js";
import { leerEmisorPresentacion } from "./representacion/emisor.js";
import { armarRepresentacion, type FacturaRepresentacion } from "./representacion/modelo.js";
import { renderFacturaPdf } from "./representacion/pdf.js";

export type PdfFactura = {
  buffer: Buffer;
  filename: string;
  model: FacturaRepresentacion;
};

export function parseVentaId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(400, "VALIDATION_ERROR", "Venta inválida");
  }
  return id;
}

async function representacionDeVenta(ventaId: number): Promise<FacturaRepresentacion> {
  const data = await cargarFacturaPersistida(ventaId);
  if (!data) {
    throw new AppError(404, "NOT_FOUND", "Sin comprobante fiscal para esta venta");
  }
  return armarRepresentacion(data, leerEmisorPresentacion());
}

/** Regenera el PDF desde lo persistido. No llama a ARCA ni crea otro comprobante. */
export async function pdfDeVenta(ventaId: number): Promise<PdfFactura> {
  const model = await representacionDeVenta(ventaId);
  const buffer = await renderFacturaPdf(model);
  return { buffer, filename: model.archivo, model };
}

export async function metaDistribucion(ventaId: number) {
  const data = await cargarFacturaPersistida(ventaId);
  if (!data) {
    throw new AppError(404, "NOT_FOUND", "Sin comprobante fiscal para esta venta");
  }
  const autorizada = esComprobanteAutorizado(data.cae, data.estado);
  let archivo: string | null = null;
  if (autorizada) {
    try {
      archivo = armarRepresentacion(data, leerEmisorPresentacion()).archivo;
    } catch {
      archivo = null;
    }
  }
  return {
    pdf_disponible: Boolean(archivo),
    archivo,
    email_sugerido: data.receptor?.email ?? null,
    telefono: data.receptor?.telefono ?? null,
    email_configurado: leerEmailConfig() != null,
    cae: autorizada ? data.cae : null,
  };
}

export async function enviarEmailDeVenta(
  ventaId: number,
  body: unknown,
): Promise<{ ok: true; destino: string }> {
  const input = emailFacturaSchema.parse(body);
  const model = await representacionDeVenta(ventaId);
  const config = leerEmailConfig();
  if (!config) {
    await registrarDistribucion({
      ventaId,
      canal: "email",
      resultado: "error",
      destino: enmascararEmail(input.to),
      detalle: "SMTP no configurado",
    });
    throw new AppError(
      503,
      "EMAIL_NO_CONFIGURADO",
      "El envío de facturas no está configurado. Definí INVOICE_SMTP_HOST e INVOICE_EMAIL_FROM.",
    );
  }
  const buffer = await renderFacturaPdf(model);
  const filename = model.archivo;
  const vars = {
    numero: model.numeroVisual,
    cae: model.cae,
    letra: model.letra,
    archivo: filename,
    total: model.totales.total,
  };
  const subject = input.subject ?? aplicarPlantilla(config.subjectTemplate, vars);
  const text = input.body ?? aplicarPlantilla(config.bodyTemplate, vars);
  try {
    await enviarFacturaEmail({
      config,
      to: input.to,
      subject,
      text,
      filename,
      pdf: buffer,
    });
  } catch (err) {
    const detalle = err instanceof Error ? err.message : "error de envío";
    await registrarDistribucion({
      ventaId,
      canal: "email",
      resultado: "error",
      destino: enmascararEmail(input.to),
      detalle,
    });
    throw new AppError(502, "EMAIL_FALLO", "No se pudo enviar el correo con la factura");
  }
  const destino = enmascararEmail(input.to);
  await registrarDistribucion({
    ventaId,
    canal: "email",
    resultado: "enviado",
    destino,
  });
  return { ok: true, destino };
}

export function basePublica(request: FastifyRequest): string {
  const configured = process.env.PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const forwardedProto = request.headers["x-forwarded-proto"];
  const proto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(",")[0]?.trim()
    || request.protocol;
  const forwardedHost = request.headers["x-forwarded-host"];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost)?.split(",")[0]?.trim()
    || request.headers.host;
  return `${proto}://${host}`;
}

export async function crearEnlaceDeVenta(ventaId: number, request: FastifyRequest) {
  const secret = secretoEnlace();
  if (!secret) {
    throw new AppError(
      503,
      "ENLACE_NO_CONFIGURADO",
      "Falta INVOICE_SHARE_SECRET o POS_JWT_SECRET para firmar el enlace de la factura",
    );
  }
  await representacionDeVenta(ventaId);
  const exp = Math.floor(Date.now() / 1000) + ttlEnlaceSegundos();
  const token = crearEnlaceToken(ventaId, exp, secret);
  const url = `${basePublica(request)}/api/v1/fiscal/publico/${token}`;
  await registrarDistribucion({
    ventaId,
    canal: "enlace",
    resultado: "generado",
    destino: "enlace-firmado",
  });
  return { url, expires_at: new Date(exp * 1000).toISOString() };
}

export function contentDisposition(filename: string): string {
  return `attachment; filename="${filename}"`;
}

export async function responderPdf(ventaId: number, reply: FastifyReply): Promise<void> {
  const { buffer, filename } = await pdfDeVenta(ventaId);
  reply
    .header("Content-Type", "application/pdf")
    .header("Content-Disposition", contentDisposition(filename))
    .header("Cache-Control", "private, no-store")
    .header("Access-Control-Expose-Headers", "Content-Disposition")
    .send(buffer);
}

export async function responderPdfPublico(token: string, reply: FastifyReply): Promise<void> {
  const secret = secretoEnlace();
  if (!secret) {
    throw new AppError(
      503,
      "ENLACE_NO_CONFIGURADO",
      "El enlace público de facturas no está configurado",
    );
  }
  const { ventaId } = verificarEnlaceToken(token, secret, Math.floor(Date.now() / 1000));
  await responderPdf(ventaId, reply);
}
