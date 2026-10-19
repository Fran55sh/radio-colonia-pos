import { pool } from "../../config/db.js";
import { AppError } from "../../middleware/errors.js";
import { getComprobanteByVentaId, rowToFiscalResponse } from "../fiscal/repository.js";
import { esComprobanteAutorizado } from "../fiscal/representacion/autorizado.js";
import { cbteTipoLabel, formatComprobanteNumero } from "../fiscal/mappers.js";

export type VentaListado = {
  id: number;
  created_at: string;
  total: number;
  medio_pago: string;
  estado: string;
  cliente: string | null;
  fiscal_estado: string | null;
  comprobante: string | null;
  pdf_disponible: boolean;
};

function money(value: string | number): number {
  return Math.round(Number(value) * 100) / 100;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function listarVentas(limit: number): Promise<VentaListado[]> {
  const { rows } = await pool.query<{
    id: number;
    created_at: Date;
    total: string;
    medio_pago: string;
    estado: string;
    cliente: string | null;
    fiscal_estado: string | null;
    cae: string | null;
    punto_venta: number | null;
    cbte_tipo: number | null;
    cbte_nro: number | null;
  }>(
    `SELECT v.id, v.created_at, v.total::text, v.medio_pago, v.estado,
            COALESCE(cl.razon_social, cl.nombre) AS cliente,
            c.estado AS fiscal_estado, c.cae, c.punto_venta, c.cbte_tipo, c.cbte_nro
     FROM pos_ventas v
     LEFT JOIN pos_clientes cl ON cl.id = v.cliente_id
     LEFT JOIN pos_comprobantes_fiscales c ON c.venta_id = v.id
     WHERE v.estado <> 'anulada'
     ORDER BY v.created_at DESC, v.id DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.id,
    created_at: iso(row.created_at),
    total: money(row.total),
    medio_pago: row.medio_pago,
    estado: row.estado,
    cliente: row.cliente,
    fiscal_estado: row.fiscal_estado,
    comprobante:
      row.cbte_nro != null && row.punto_venta != null && row.cbte_tipo != null
        ? formatComprobanteNumero(row.punto_venta, row.cbte_tipo, row.cbte_nro)
        : null,
    pdf_disponible: esComprobanteAutorizado(row.cae, row.fiscal_estado ?? ""),
  }));
}

export async function detalleVenta(ventaId: number) {
  const ventaRes = await pool.query<{
    id: number;
    created_at: Date;
    total: string;
    neto_gravado: string;
    iva_total: string;
    exento: string;
    medio_pago: string;
    estado: string;
    cliente_id: number | null;
    cliente_nombre: string | null;
    razon_social: string | null;
    documento: string | null;
    domicilio_fiscal: string | null;
    email: string | null;
    telefono: string | null;
    condicion_iva_receptor_id: number | null;
  }>(
    `SELECT v.id, v.created_at, v.total::text, v.neto_gravado::text, v.iva_total::text, v.exento::text,
            v.medio_pago, v.estado, v.cliente_id,
            cl.nombre AS cliente_nombre, cl.razon_social, cl.documento, cl.domicilio_fiscal,
            cl.email, cl.telefono, cl.condicion_iva_receptor_id
     FROM pos_ventas v
     LEFT JOIN pos_clientes cl ON cl.id = v.cliente_id
     WHERE v.id = $1`,
    [ventaId],
  );
  const venta = ventaRes.rows[0];
  if (!venta || venta.estado === "anulada") {
    throw new AppError(404, "NOT_FOUND", "Venta no encontrada");
  }
  const lineasRes = await pool.query<{
    codigo: string;
    descripcion: string;
    cantidad: string;
    precio_unitario: string;
    alicuota_iva: string;
    neto_linea: string;
    iva_linea: string;
    total_linea: string;
  }>(
    `SELECT sku_snapshot AS codigo, name_snapshot AS descripcion, cantidad::text,
            precio_unitario::text, alicuota_iva::text, neto_linea::text, iva_linea::text, total_linea::text
     FROM pos_lineas_venta
     WHERE venta_id = $1
     ORDER BY id`,
    [ventaId],
  );
  const comp = await getComprobanteByVentaId(ventaId);
  return {
    venta: {
      id: venta.id,
      created_at: iso(venta.created_at),
      total: money(venta.total),
      neto_gravado: money(venta.neto_gravado),
      iva_total: money(venta.iva_total),
      exento: money(venta.exento),
      medio_pago: venta.medio_pago,
      estado: venta.estado,
      cliente: venta.cliente_id
        ? {
            id: venta.cliente_id,
            nombre: venta.cliente_nombre,
            razon_social: venta.razon_social,
            documento: venta.documento,
            domicilio_fiscal: venta.domicilio_fiscal,
            email: venta.email,
            telefono: venta.telefono,
            condicion_iva_receptor_id: venta.condicion_iva_receptor_id,
          }
        : null,
    },
    lineas: lineasRes.rows.map((linea) => ({
      codigo: linea.codigo,
      descripcion: linea.descripcion,
      cantidad: Number(linea.cantidad),
      precio_unitario: money(linea.precio_unitario),
      alicuota_iva: Number(linea.alicuota_iva),
      neto: money(linea.neto_linea),
      iva: money(linea.iva_linea),
      total: money(linea.total_linea),
    })),
    fiscal: comp ? rowToFiscalResponse(comp) : null,
    pdf_disponible: comp ? esComprobanteAutorizado(comp.cae, comp.estado) : false,
    cbte_tipo_label: comp ? cbteTipoLabel(comp.cbte_tipo) : null,
  };
}
