import { pool } from "../../config/db.js";
import { roundMoney } from "./representacion/formato.js";
import type { FacturaPersistida, IvaPersistido, ReceptorPersistido } from "./representacion/modelo.js";

type ComprobanteQuery = {
  venta_id: number;
  estado: string;
  ambiente: string;
  emisor_cuit: string;
  punto_venta: number;
  cbte_tipo: number;
  cbte_nro: number | null;
  fecha_cbte: string | null;
  cae: string | null;
  cae_vencimiento: string | null;
  qr_url: string | null;
  doc_tipo: number | null;
  doc_nro: string | null;
  condicion_iva_receptor_id: number | null;
  neto_gravado: string;
  iva_total: string;
  exento: string;
  total: string;
  imp_total_enviado: string | null;
  iva_detalle: unknown;
  medio_pago: string | null;
  receptor_snapshot: {
    nombre: string | null;
    razon_social: string | null;
    domicilio_fiscal: string | null;
  } | null;
  email: string | null;
  telefono: string | null;
  request_payload: unknown;
};

function money(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? roundMoney(n) : 0;
}

export function parseIvaDetalle(raw: unknown): IvaPersistido[] {
  if (!Array.isArray(raw)) return [];
  const out: IvaPersistido[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as { Id?: unknown; BaseImp?: unknown; Importe?: unknown };
    const id = Number(row.Id);
    const base = Number(row.BaseImp);
    const importe = Number(row.Importe);
    if (!Number.isFinite(id) || !Number.isFinite(base) || !Number.isFinite(importe)) continue;
    out.push({ id, base: roundMoney(base), importe: roundMoney(importe) });
  }
  return out;
}

function parsePayload(raw: unknown): {
  moneda: string | null;
  cotizacion: number | null;
  impTrib: number | null;
  concepto: number | null;
  ivaDetalle: IvaPersistido[] | null;
} {
  if (!raw || typeof raw !== "object") {
    return { moneda: null, cotizacion: null, impTrib: null, concepto: null, ivaDetalle: null };
  }
  const payload = raw as {
    MonId?: unknown;
    MonCotiz?: unknown;
    ImpTrib?: unknown;
    Concepto?: unknown;
    Iva?: unknown;
  };
  const cotizacion = payload.MonCotiz == null ? null : Number(payload.MonCotiz);
  const impTrib = payload.ImpTrib == null ? null : Number(payload.ImpTrib);
  const concepto = payload.Concepto == null ? null : Number(payload.Concepto);
  const iva = parseIvaDetalle(payload.Iva);
  return {
    moneda: typeof payload.MonId === "string" ? payload.MonId : null,
    cotizacion: cotizacion != null && Number.isFinite(cotizacion) ? cotizacion : null,
    impTrib: impTrib != null && Number.isFinite(impTrib) ? roundMoney(impTrib) : null,
    concepto: concepto != null && Number.isFinite(concepto) ? concepto : null,
    ivaDetalle: iva.length > 0 ? iva : null,
  };
}

export async function cargarFacturaPersistida(ventaId: number): Promise<FacturaPersistida | null> {
  const { rows } = await pool.query<ComprobanteQuery>(
    `SELECT c.venta_id, c.estado, c.ambiente, c.emisor_cuit, c.punto_venta, c.cbte_tipo,
            c.cbte_nro, c.fecha_cbte::text AS fecha_cbte, c.cae, c.cae_vencimiento::text AS cae_vencimiento,
            c.qr_url, c.doc_tipo, c.doc_nro::text AS doc_nro, c.condicion_iva_receptor_id,
            c.neto_gravado::text, c.iva_total::text, c.exento::text, c.total::text,
            c.imp_total_enviado::text, c.iva_detalle,
            v.medio_pago,
            i.request_payload->'receptor_snapshot' AS receptor_snapshot,
            cl.email, cl.telefono,
            i.request_payload
     FROM pos_comprobantes_fiscales c
     JOIN pos_ventas v ON v.id = c.venta_id
     LEFT JOIN pos_clientes cl ON cl.id = v.cliente_id
     LEFT JOIN pos_comprobantes_fiscales_intentos i ON i.id = c.intento_actual_id
     WHERE c.venta_id = $1`,
    [ventaId],
  );
  const row = rows[0];
  if (!row) return null;

  const lineasRes = await pool.query<{
    sku_snapshot: string;
    name_snapshot: string;
    cantidad: string;
    precio_unitario: string;
    alicuota_iva: string;
    neto_linea: string;
    iva_linea: string;
    exento_linea: string;
    total_linea: string;
  }>(
    `SELECT sku_snapshot, name_snapshot, cantidad::text, precio_unitario::text, alicuota_iva::text,
            neto_linea::text, iva_linea::text, exento_linea::text, total_linea::text
     FROM pos_lineas_venta
     WHERE venta_id = $1
     ORDER BY id`,
    [ventaId],
  );

  const payload = parsePayload(row.request_payload);
  const ivaDetalle = parseIvaDetalle(row.iva_detalle);
  // Los comprobantes anteriores al snapshot no tienen una identidad histórica
  // recuperable: no sustituirla por los datos editables del cliente actual.
  const snapshot = row.receptor_snapshot;
  const receptor: ReceptorPersistido | null =
    snapshot || row.email || row.telefono
    ? {
        nombre: snapshot?.nombre ?? null,
        razonSocial: snapshot?.razon_social ?? null,
        domicilio: snapshot?.domicilio_fiscal ?? null,
        email: row.email,
        telefono: row.telefono,
      }
    : null;

  return {
    ventaId: row.venta_id,
    estado: row.estado,
    ambiente: row.ambiente,
    emisorCuit: row.emisor_cuit,
    puntoVenta: row.punto_venta,
    cbteTipo: row.cbte_tipo,
    cbteNro: row.cbte_nro,
    fechaCbte: row.fecha_cbte,
    cae: row.cae,
    caeVencimiento: row.cae_vencimiento,
    qrUrl: row.qr_url,
    docTipo: row.doc_tipo,
    docNro: row.doc_nro == null ? null : Number(row.doc_nro),
    condicionIvaReceptorId: row.condicion_iva_receptor_id,
    netoGravado: money(row.neto_gravado),
    ivaTotal: money(row.iva_total),
    exento: money(row.exento),
    total: money(row.total),
    impTotalEnviado: row.imp_total_enviado == null ? null : money(row.imp_total_enviado),
    ivaDetalle: ivaDetalle.length > 0 ? ivaDetalle : (payload.ivaDetalle ?? []),
    moneda: payload.moneda,
    cotizacion: payload.cotizacion,
    impTrib: payload.impTrib,
    concepto: payload.concepto,
    medioPago: row.medio_pago,
    receptor,
    lineas: lineasRes.rows.map((linea) => ({
      codigo: linea.sku_snapshot,
      descripcion: linea.name_snapshot,
      cantidad: Number(linea.cantidad),
      precioUnitario: money(linea.precio_unitario),
      alicuota: Number(linea.alicuota_iva),
      neto: money(linea.neto_linea),
      iva: money(linea.iva_linea),
      exento: money(linea.exento_linea),
      total: money(linea.total_linea),
    })),
  };
}
