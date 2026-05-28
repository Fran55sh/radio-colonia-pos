import { pool } from "../../config/db.js";
import { AppError } from "../../middleware/errors.js";

export async function listClientes() {
  const { rows } = await pool.query(`SELECT * FROM pos_clientes ORDER BY nombre`);
  return rows;
}

export async function getCliente(id: number) {
  const { rows } = await pool.query(`SELECT * FROM pos_clientes WHERE id = $1`, [id]);
  if (rows.length === 0) throw new AppError(404, "NOT_FOUND", "Cliente no encontrado");
  return rows[0];
}

export async function createCliente(data: {
  nombre: string;
  documento?: string;
  email?: string;
  telefono?: string;
}) {
  const { rows } = await pool.query(
    `INSERT INTO pos_clientes (nombre, documento, email, telefono) VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.nombre, data.documento ?? null, data.email || null, data.telefono ?? null],
  );
  return rows[0];
}

export async function updateCliente(
  id: number,
  data: Partial<{ nombre: string; documento: string; email: string; telefono: string }>,
) {
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      fields.push(`${key} = $${i++}`);
      values.push(val);
    }
  }
  if (fields.length === 0) return getCliente(id);
  values.push(id);
  const { rows } = await pool.query(
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
