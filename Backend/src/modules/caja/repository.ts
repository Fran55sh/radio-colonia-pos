import type { DbClient } from "../../config/db.js";
import { pool } from "../../config/db.js";

export type CajaSesionRow = {
  id: number;
  puesto: string;
  estado: "abierta" | "cerrada" | "cancelada";
  opened_at: Date;
  opened_by_label: string | null;
  closed_at: Date | null;
  closed_by_label: string | null;
  notes: string | null;
};

export type CajaSaldoRow = {
  id: number;
  sesion_id: number;
  payment_method: string;
  amount: string;
};

export type CajaMovimientoRow = {
  id: number;
  sesion_id: number;
  occurred_at: Date;
  tipo: string;
  direccion: string;
  amount: string;
  payment_method: string;
  description: string | null;
  source_type: string;
  source_id: string | null;
  created_by_label: string | null;
  approved_by_label: string | null;
  estado: string;
  post_cierre_offline: boolean;
};

export type CajaDiferenciaRow = {
  id: number;
  sesion_id: number;
  expected_cash: string;
  counted_cash: string;
  difference: string;
  categoria: string | null;
  observations: string | null;
  approved_by_label: string | null;
};

type Client = DbClient | typeof pool;

export async function findOpenSessionByPuesto(
  client: Client,
  puesto: string,
): Promise<CajaSesionRow | null> {
  const { rows } = await client.query<CajaSesionRow>(
    `SELECT id, puesto, estado, opened_at, opened_by_label, closed_at, closed_by_label, notes
     FROM pos_caja_sesiones
     WHERE puesto = $1 AND estado = 'abierta'
     LIMIT 1`,
    [puesto],
  );
  return rows[0] ?? null;
}

export async function findSessionById(
  client: Client,
  id: number,
): Promise<CajaSesionRow | null> {
  const { rows } = await client.query<CajaSesionRow>(
    `SELECT id, puesto, estado, opened_at, opened_by_label, closed_at, closed_by_label, notes
     FROM pos_caja_sesiones WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function insertSession(
  client: DbClient,
  input: {
    puesto: string;
    opened_by_label: string;
    notes?: string | null;
  },
): Promise<CajaSesionRow> {
  const { rows } = await client.query<CajaSesionRow>(
    `INSERT INTO pos_caja_sesiones (puesto, estado, opened_by_label, notes)
     VALUES ($1, 'abierta', $2, $3)
     RETURNING id, puesto, estado, opened_at, opened_by_label, closed_at, closed_by_label, notes`,
    [input.puesto, input.opened_by_label, input.notes ?? null],
  );
  return rows[0];
}

export async function insertOpeningBalances(
  client: DbClient,
  sesionId: number,
  saldos: Array<{ payment_method: string; amount: number }>,
): Promise<void> {
  for (const s of saldos) {
    await client.query(
      `INSERT INTO pos_caja_saldos_iniciales (sesion_id, payment_method, amount)
       VALUES ($1, $2, $3)`,
      [sesionId, s.payment_method, s.amount],
    );
  }
}

export async function listOpeningBalances(
  client: Client,
  sesionId: number,
): Promise<CajaSaldoRow[]> {
  const { rows } = await client.query<CajaSaldoRow>(
    `SELECT id, sesion_id, payment_method, amount
     FROM pos_caja_saldos_iniciales WHERE sesion_id = $1
     ORDER BY payment_method`,
    [sesionId],
  );
  return rows;
}

export async function listMovimientos(
  client: Client,
  sesionId: number,
  limit: number,
  offset: number,
): Promise<{ rows: CajaMovimientoRow[]; total: number }> {
  const countRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM pos_caja_movimientos WHERE sesion_id = $1`,
    [sesionId],
  );
  const { rows } = await client.query<CajaMovimientoRow>(
    `SELECT id, sesion_id, occurred_at, tipo, direccion, amount, payment_method,
            description, source_type, source_id, created_by_label, approved_by_label,
            estado, post_cierre_offline
     FROM pos_caja_movimientos
     WHERE sesion_id = $1
     ORDER BY occurred_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [sesionId, limit, offset],
  );
  return { rows, total: Number(countRes.rows[0]?.count ?? 0) };
}

export async function insertMovimiento(
  client: DbClient,
  input: {
    sesion_id: number;
    tipo: string;
    direccion: string;
    amount: number;
    payment_method: string;
    description?: string | null;
    source_type: string;
    source_id?: string | null;
    created_by_label?: string | null;
    approved_by_label?: string | null;
    post_cierre_offline?: boolean;
  },
): Promise<CajaMovimientoRow> {
  const { rows } = await client.query<CajaMovimientoRow>(
    `INSERT INTO pos_caja_movimientos (
       sesion_id, tipo, direccion, amount, payment_method, description,
       source_type, source_id, created_by_label, approved_by_label, post_cierre_offline
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, sesion_id, occurred_at, tipo, direccion, amount, payment_method,
               description, source_type, source_id, created_by_label, approved_by_label,
               estado, post_cierre_offline`,
    [
      input.sesion_id,
      input.tipo,
      input.direccion,
      input.amount,
      input.payment_method,
      input.description ?? null,
      input.source_type,
      input.source_id ?? null,
      input.created_by_label ?? null,
      input.approved_by_label ?? null,
      input.post_cierre_offline ?? false,
    ],
  );
  return rows[0];
}

/** Idempotent SALE movement: insert or return existing active one. */
export async function ensureSaleMovimiento(
  client: DbClient,
  input: {
    sesion_id: number;
    amount: number;
    payment_method: string;
    source_id: string;
    created_by_label?: string | null;
    post_cierre_offline?: boolean;
  },
): Promise<{ row: CajaMovimientoRow; created: boolean }> {
  const existing = await client.query<CajaMovimientoRow>(
    `SELECT id, sesion_id, occurred_at, tipo, direccion, amount, payment_method,
            description, source_type, source_id, created_by_label, approved_by_label,
            estado, post_cierre_offline
     FROM pos_caja_movimientos
     WHERE source_type = 'SALE' AND source_id = $1 AND estado = 'activo'
     LIMIT 1`,
    [input.source_id],
  );
  if (existing.rows[0]) {
    return { row: existing.rows[0], created: false };
  }

  try {
    const row = await insertMovimiento(client, {
      sesion_id: input.sesion_id,
      tipo: "venta",
      direccion: "ingreso",
      amount: input.amount,
      payment_method: input.payment_method,
      description: `Venta #${input.source_id}`,
      source_type: "SALE",
      source_id: input.source_id,
      created_by_label: input.created_by_label,
      post_cierre_offline: input.post_cierre_offline,
    });
    return { row, created: true };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      const again = await client.query<CajaMovimientoRow>(
        `SELECT id, sesion_id, occurred_at, tipo, direccion, amount, payment_method,
                description, source_type, source_id, created_by_label, approved_by_label,
                estado, post_cierre_offline
         FROM pos_caja_movimientos
         WHERE source_type = 'SALE' AND source_id = $1 AND estado = 'activo'
         LIMIT 1`,
        [input.source_id],
      );
      if (again.rows[0]) return { row: again.rows[0], created: false };
    }
    throw err;
  }
}

export async function findMovimientoById(
  client: Client,
  id: number,
): Promise<CajaMovimientoRow | null> {
  const { rows } = await client.query<CajaMovimientoRow>(
    `SELECT id, sesion_id, occurred_at, tipo, direccion, amount, payment_method,
            description, source_type, source_id, created_by_label, approved_by_label,
            estado, post_cierre_offline
     FROM pos_caja_movimientos WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function anularMovimiento(
  client: DbClient,
  id: number,
  anuladoBy: string,
  motivo?: string | null,
): Promise<CajaMovimientoRow> {
  const { rows } = await client.query<CajaMovimientoRow>(
    `UPDATE pos_caja_movimientos
     SET estado = 'anulado', anulado_at = NOW(), anulado_by_label = $2, anulado_motivo = $3
     WHERE id = $1
     RETURNING id, sesion_id, occurred_at, tipo, direccion, amount, payment_method,
               description, source_type, source_id, created_by_label, approved_by_label,
               estado, post_cierre_offline`,
    [id, anuladoBy, motivo ?? null],
  );
  return rows[0];
}

export async function sumActiveMovimientos(
  client: Client,
  sesionId: number,
): Promise<Array<{ payment_method: string; direccion: string; total: string }>> {
  const { rows } = await client.query<{
    payment_method: string;
    direccion: string;
    total: string;
  }>(
    `SELECT payment_method, direccion, COALESCE(SUM(amount), 0)::text AS total
     FROM pos_caja_movimientos
     WHERE sesion_id = $1 AND estado = 'activo'
     GROUP BY payment_method, direccion`,
    [sesionId],
  );
  return rows;
}

export async function closeSession(
  client: DbClient,
  sesionId: number,
  closedBy: string,
): Promise<CajaSesionRow> {
  const { rows } = await client.query<CajaSesionRow>(
    `UPDATE pos_caja_sesiones
     SET estado = 'cerrada', closed_at = NOW(), closed_by_label = $2
     WHERE id = $1 AND estado = 'abierta'
     RETURNING id, puesto, estado, opened_at, opened_by_label, closed_at, closed_by_label, notes`,
    [sesionId, closedBy],
  );
  return rows[0];
}

export async function insertDiferencia(
  client: DbClient,
  input: {
    sesion_id: number;
    expected_cash: number;
    counted_cash: number;
    difference: number;
    categoria?: string | null;
    observations?: string | null;
    approved_by_label?: string | null;
  },
): Promise<CajaDiferenciaRow> {
  const { rows } = await client.query<CajaDiferenciaRow>(
    `INSERT INTO pos_caja_diferencias (
       sesion_id, expected_cash, counted_cash, difference,
       categoria, observations, approved_by_label
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, sesion_id, expected_cash, counted_cash, difference,
               categoria, observations, approved_by_label`,
    [
      input.sesion_id,
      input.expected_cash,
      input.counted_cash,
      input.difference,
      input.categoria ?? null,
      input.observations ?? null,
      input.approved_by_label ?? null,
    ],
  );
  return rows[0];
}

export async function findDiferenciaBySesion(
  client: Client,
  sesionId: number,
): Promise<CajaDiferenciaRow | null> {
  const { rows } = await client.query<CajaDiferenciaRow>(
    `SELECT id, sesion_id, expected_cash, counted_cash, difference,
            categoria, observations, approved_by_label
     FROM pos_caja_diferencias WHERE sesion_id = $1`,
    [sesionId],
  );
  return rows[0] ?? null;
}
