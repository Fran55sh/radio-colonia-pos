import { pool } from "../../config/db.js";
import { AppError } from "../../middleware/errors.js";
import { CONDICION_IVA_RI } from "../fiscal/resolver.js";
import type { ClienteFiscal } from "../fiscal/types.js";

export type PosCliente = {
  id: number;
  nombre: string;
  documento: string | null;
  documento_tipo_afip: string | null;
  condicion_iva_receptor_id: number | null;
  razon_social: string | null;
  domicilio_fiscal: string | null;
  email: string | null;
  telefono: string | null;
  created_at: Date;
};

function normalizeDocumento(documento?: string): string | null {
  if (!documento?.trim()) return null;
  return documento.trim();
}

function normalizeCuitDigits(documento: string | null): string | null {
  if (!documento) return null;
  const digits = documento.replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

function validateFiscalFields(data: {
  documento?: string;
  documento_tipo_afip?: string;
  condicion_iva_receptor_id?: number;
}): void {
  const tipo = data.documento_tipo_afip;
  const doc = normalizeDocumento(data.documento);
  if (tipo === "CUIT") {
    if (!normalizeCuitDigits(doc)) {
      throw new AppError(400, "CUIT_INVALIDO", "CUIT debe tener 11 dígitos");
    }
    if (data.condicion_iva_receptor_id == null) {
      throw new AppError(
        400,
        "CONDICION_IVA_REQUERIDA",
        "Condición IVA requerida para clientes con CUIT",
      );
    }
  }
}

export async function listClientes(search?: string, limit = 50): Promise<PosCliente[]> {
  const params: unknown[] = [];
  let sql = `SELECT * FROM pos_clientes`;
  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    sql += ` WHERE nombre ILIKE $1 OR documento ILIKE $1 OR razon_social ILIKE $1`;
  }
  params.push(limit);
  sql += ` ORDER BY nombre LIMIT $${params.length}`;
  const { rows } = await pool.query<PosCliente>(sql, params);
  return rows;
}

export async function getCliente(id: number): Promise<PosCliente> {
  const { rows } = await pool.query<PosCliente>(`SELECT * FROM pos_clientes WHERE id = $1`, [
    id,
  ]);
  if (rows.length === 0) throw new AppError(404, "NOT_FOUND", "Cliente no encontrado");
  return rows[0];
}

export async function getClienteFiscalById(id: number): Promise<ClienteFiscal> {
  const c = await getCliente(id);
  return {
    id: c.id,
    nombre: c.nombre,
    documento: c.documento,
    documento_tipo_afip: c.documento_tipo_afip,
    condicion_iva_receptor_id: c.condicion_iva_receptor_id,
    razon_social: c.razon_social,
  };
}

export async function createCliente(data: {
  nombre: string;
  documento?: string;
  documento_tipo_afip?: string;
  condicion_iva_receptor_id?: number;
  razon_social?: string;
  domicilio_fiscal?: string;
  email?: string;
  telefono?: string;
}): Promise<PosCliente> {
  validateFiscalFields(data);
  const doc = normalizeDocumento(data.documento);
  const docTipo =
    data.documento_tipo_afip ??
    (normalizeCuitDigits(doc) ? "CUIT" : doc ? "DNI" : "CF");

  const { rows } = await pool.query<PosCliente>(
    `INSERT INTO pos_clientes (
      nombre, documento, documento_tipo_afip, condicion_iva_receptor_id,
      razon_social, domicilio_fiscal, email, telefono
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      data.nombre,
      doc,
      docTipo,
      data.condicion_iva_receptor_id ?? null,
      data.razon_social ?? null,
      data.domicilio_fiscal ?? null,
      data.email || null,
      data.telefono ?? null,
    ],
  );
  return rows[0];
}

export async function updateCliente(
  id: number,
  data: Partial<{
    nombre: string;
    documento: string;
    documento_tipo_afip: string;
    condicion_iva_receptor_id: number;
    razon_social: string;
    domicilio_fiscal: string;
    email: string;
    telefono: string;
  }>,
): Promise<PosCliente> {
  const current = await getCliente(id);
  validateFiscalFields({
    documento: data.documento ?? current.documento ?? undefined,
    documento_tipo_afip: data.documento_tipo_afip ?? current.documento_tipo_afip ?? undefined,
    condicion_iva_receptor_id:
      data.condicion_iva_receptor_id ?? current.condicion_iva_receptor_id ?? undefined,
  });

  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      fields.push(`${key} = $${i++}`);
      values.push(val === "" ? null : val);
    }
  }
  if (fields.length === 0) return current;
  values.push(id);
  const { rows } = await pool.query<PosCliente>(
    `UPDATE pos_clientes SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
    values,
  );
  if (rows.length === 0) throw new AppError(404, "NOT_FOUND", "Cliente no encontrado");
  return rows[0];
}

export async function historialCompras(clienteId: number) {
  const { rows } = await pool.query(
    `SELECT v.id, v.total, v.medio_pago, v.created_at,
            COALESCE(json_agg(json_build_object(
              'codigo_interno', lv.sku_snapshot,
              'cantidad', lv.cantidad,
              'total_linea', lv.total_linea
            )) FILTER (WHERE lv.id IS NOT NULL), '[]') AS lineas
     FROM pos_ventas v
     LEFT JOIN pos_lineas_venta lv ON lv.venta_id = v.id
     WHERE v.cliente_id = $1
     GROUP BY v.id
     ORDER BY v.created_at DESC
     LIMIT 100`,
    [clienteId],
  );
  return rows;
}

export { CONDICION_IVA_RI };
