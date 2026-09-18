import { withTransaction } from "../../config/db.js";
import type { AuthContext } from "../../middleware/auth.js";
import { AppError } from "../../middleware/errors.js";
import { assertAdminPin } from "../auth/service.js";
import * as repo from "./repository.js";
import type {
  CloseSessionInput,
  ManualMovementInput,
  OpenSessionInput,
} from "./schemas.js";
import { DEFAULT_PUESTO } from "./schemas.js";

export const EFECTIVO = "Efectivo";

export function actorLabel(ctx: AuthContext | undefined): string {
  if (!ctx) return "unknown";
  return `${ctx.role}:${ctx.via}`;
}

/** Pure: expected cash = opening Efectivo + ingresos Efectivo − egresos Efectivo. */
export function computeExpectedCash(input: {
  openingEfectivo: number;
  movimientos: Array<{
    payment_method: string;
    direccion: "ingreso" | "egreso" | string;
    amount: number;
    estado?: string;
  }>;
}): number {
  let expected = input.openingEfectivo;
  for (const m of input.movimientos) {
    if (m.estado != null && m.estado !== "activo") continue;
    if (m.payment_method !== EFECTIVO) continue;
    if (m.direccion === "ingreso") expected += m.amount;
    else if (m.direccion === "egreso") expected -= m.amount;
  }
  return Math.round(expected * 100) / 100;
}

function mapSesion(row: repo.CajaSesionRow) {
  return {
    id: row.id,
    puesto: row.puesto,
    estado: row.estado,
    opened_at: row.opened_at,
    opened_by_label: row.opened_by_label,
    closed_at: row.closed_at,
    closed_by_label: row.closed_by_label,
    notes: row.notes,
  };
}

function mapMovimiento(row: repo.CajaMovimientoRow) {
  return {
    id: row.id,
    sesion_id: row.sesion_id,
    occurred_at: row.occurred_at,
    tipo: row.tipo,
    direccion: row.direccion,
    amount: Number(row.amount),
    payment_method: row.payment_method,
    description: row.description,
    source_type: row.source_type,
    source_id: row.source_id,
    created_by_label: row.created_by_label,
    approved_by_label: row.approved_by_label,
    estado: row.estado,
    post_cierre_offline: row.post_cierre_offline,
  };
}

export async function getSesionActual(puesto = DEFAULT_PUESTO) {
  const sesion = await repo.findOpenSessionByPuesto(
    (await import("../../config/db.js")).pool,
    puesto,
  );
  if (!sesion) {
    throw new AppError(404, "CAJA_SIN_SESION", "No hay sesión de caja abierta", {
      puesto,
    });
  }
  const saldos = await repo.listOpeningBalances(
    (await import("../../config/db.js")).pool,
    sesion.id,
  );
  return {
    ...mapSesion(sesion),
    saldos: saldos.map((s) => ({
      payment_method: s.payment_method,
      amount: Number(s.amount),
    })),
  };
}

export async function abrirSesion(
  input: OpenSessionInput,
  ctx: AuthContext | undefined,
) {
  const puesto = input.puesto || DEFAULT_PUESTO;
  const { pool } = await import("../../config/db.js");
  const existing = await repo.findOpenSessionByPuesto(pool, puesto);
  if (existing) {
    throw new AppError(
      409,
      "CAJA_YA_ABIERTA",
      `Ya hay una sesión abierta en ${puesto}`,
      { sesion_id: existing.id },
    );
  }

  // Ensure all MVP payment methods present (missing = 0)
  const byMethod = new Map(
    input.saldos.map((s) => [s.payment_method, s.amount] as const),
  );
  const saldos = [
    { payment_method: "Efectivo", amount: byMethod.get("Efectivo") ?? 0 },
    {
      payment_method: "Débito/Crédito",
      amount: byMethod.get("Débito/Crédito") ?? 0,
    },
    {
      payment_method: "Mercado Pago QR",
      amount: byMethod.get("Mercado Pago QR") ?? 0,
    },
  ];

  const label = actorLabel(ctx);
  const sesion = await withTransaction(async (client) => {
    const created = await repo.insertSession(client, {
      puesto,
      opened_by_label: label,
      notes: input.notes,
    });
    await repo.insertOpeningBalances(client, created.id, saldos);
    return created;
  });

  return {
    ...mapSesion(sesion),
    saldos,
  };
}

export async function getSesionDetalle(id: number) {
  const { pool } = await import("../../config/db.js");
  const sesion = await repo.findSessionById(pool, id);
  if (!sesion) {
    throw new AppError(404, "CAJA_SESION_NO_ENCONTRADA", "Sesión no encontrada");
  }
  const saldos = await repo.listOpeningBalances(pool, id);
  const diferencia = await repo.findDiferenciaBySesion(pool, id);
  return {
    ...mapSesion(sesion),
    saldos: saldos.map((s) => ({
      payment_method: s.payment_method,
      amount: Number(s.amount),
    })),
    diferencia: diferencia
      ? {
          expected_cash: Number(diferencia.expected_cash),
          counted_cash: Number(diferencia.counted_cash),
          difference: Number(diferencia.difference),
          categoria: diferencia.categoria,
          observations: diferencia.observations,
          approved_by_label: diferencia.approved_by_label,
        }
      : null,
  };
}

export async function listMovimientosSesion(
  id: number,
  limit: number,
  offset: number,
) {
  const { pool } = await import("../../config/db.js");
  const sesion = await repo.findSessionById(pool, id);
  if (!sesion) {
    throw new AppError(404, "CAJA_SESION_NO_ENCONTRADA", "Sesión no encontrada");
  }
  const { rows, total } = await repo.listMovimientos(pool, id, limit, offset);
  return {
    movimientos: rows.map(mapMovimiento),
    total,
    limit,
    offset,
  };
}

export async function getResumen(id: number) {
  const { pool } = await import("../../config/db.js");
  const sesion = await repo.findSessionById(pool, id);
  if (!sesion) {
    throw new AppError(404, "CAJA_SESION_NO_ENCONTRADA", "Sesión no encontrada");
  }
  const saldos = await repo.listOpeningBalances(pool, id);
  const sums = await repo.sumActiveMovimientos(pool, id);

  const openingEfectivo =
    Number(saldos.find((s) => s.payment_method === EFECTIVO)?.amount ?? 0) || 0;

  const movimientosFlat = sums.map((s) => ({
    payment_method: s.payment_method,
    direccion: s.direccion,
    amount: Number(s.total),
    estado: "activo" as const,
  }));

  const expected_cash = computeExpectedCash({
    openingEfectivo,
    movimientos: movimientosFlat,
  });

  const byMethod: Record<
    string,
    { opening: number; ingresos: number; egresos: number; net: number }
  > = {};

  for (const s of saldos) {
    byMethod[s.payment_method] = {
      opening: Number(s.amount),
      ingresos: 0,
      egresos: 0,
      net: Number(s.amount),
    };
  }

  for (const s of sums) {
    if (!byMethod[s.payment_method]) {
      byMethod[s.payment_method] = {
        opening: 0,
        ingresos: 0,
        egresos: 0,
        net: 0,
      };
    }
    const total = Number(s.total);
    if (s.direccion === "ingreso") {
      byMethod[s.payment_method].ingresos += total;
      byMethod[s.payment_method].net += total;
    } else {
      byMethod[s.payment_method].egresos += total;
      byMethod[s.payment_method].net -= total;
    }
  }

  return {
    sesion_id: id,
    puesto: sesion.puesto,
    estado: sesion.estado,
    expected_cash,
    by_payment_method: byMethod,
  };
}

export async function crearMovimientoManual(
  input: ManualMovementInput,
  ctx: AuthContext | undefined,
) {
  const { pool } = await import("../../config/db.js");
  const sesion = await repo.findSessionById(pool, input.sesion_id);
  if (!sesion) {
    throw new AppError(404, "CAJA_SESION_NO_ENCONTRADA", "Sesión no encontrada");
  }
  if (sesion.estado !== "abierta") {
    throw new AppError(409, "CAJA_YA_CERRADA", "La sesión ya está cerrada");
  }

  let approvedBy: string | null = null;
  if (input.tipo === "retiro") {
    if (!input.admin_pin) {
      throw new AppError(
        403,
        "CAJA_RETIRO_REQUIERE_ADMIN",
        "Retiro requiere PIN admin",
      );
    }
    assertAdminPin(input.admin_pin);
    approvedBy = "admin:pin";
  }

  const direccion =
    input.tipo === "ingreso_manual" ? "ingreso" : "egreso";

  let warning: string | undefined;
  if (input.tipo === "retiro" && input.payment_method === EFECTIVO) {
    const resumen = await getResumen(input.sesion_id);
    if (input.amount > resumen.expected_cash) {
      warning =
        "Retiro mayor al efectivo esperado; la diferencia aparecerá al cierre";
    }
  }

  const row = await withTransaction(async (client) =>
    repo.insertMovimiento(client, {
      sesion_id: input.sesion_id,
      tipo: input.tipo,
      direccion,
      amount: input.amount,
      payment_method: input.payment_method,
      description: input.description,
      source_type: "MANUAL",
      created_by_label: actorLabel(ctx),
      approved_by_label: approvedBy,
    }),
  );

  return { movimiento: mapMovimiento(row), warning };
}

export async function cerrarSesion(
  id: number,
  input: CloseSessionInput,
  ctx: AuthContext | undefined,
) {
  const { pool } = await import("../../config/db.js");
  const sesion = await repo.findSessionById(pool, id);
  if (!sesion) {
    throw new AppError(404, "CAJA_SESION_NO_ENCONTRADA", "Sesión no encontrada");
  }
  if (sesion.estado !== "abierta") {
    throw new AppError(409, "CAJA_YA_CERRADA", "La sesión ya está cerrada");
  }

  const resumen = await getResumen(id);
  const expected = resumen.expected_cash;
  const difference =
    Math.round((input.counted_cash - expected) * 100) / 100;

  let approvedBy: string | null = null;
  if (difference !== 0) {
    if (!input.admin_pin) {
      throw new AppError(
        403,
        "CAJA_DIFF_REQUIERE_ADMIN",
        "Cierre con diferencia requiere PIN admin",
        { expected_cash: expected, counted_cash: input.counted_cash, difference },
      );
    }
    assertAdminPin(input.admin_pin);
    approvedBy = "admin:pin";
  }

  const label = actorLabel(ctx);

  const result = await withTransaction(async (client) => {
    const closed = await repo.closeSession(client, id, label);
    if (!closed) {
      throw new AppError(409, "CAJA_YA_CERRADA", "La sesión ya está cerrada");
    }

    if (difference !== 0) {
      await repo.insertMovimiento(client, {
        sesion_id: id,
        tipo: difference > 0 ? "ingreso_manual" : "gasto",
        direccion: difference > 0 ? "ingreso" : "egreso",
        amount: Math.abs(difference),
        payment_method: EFECTIVO,
        description: `Ajuste diferencia de cierre (${difference > 0 ? "sobrante" : "faltante"})`,
        source_type: "SYSTEM",
        source_id: `diff-${id}`,
        created_by_label: label,
        approved_by_label: approvedBy,
      });
    }

    const diferencia = await repo.insertDiferencia(client, {
      sesion_id: id,
      expected_cash: expected,
      counted_cash: input.counted_cash,
      difference,
      categoria: input.categoria,
      observations: input.observations,
      approved_by_label: approvedBy,
    });

    return { closed, diferencia };
  });

  return {
    sesion: mapSesion(result.closed),
    diferencia: {
      expected_cash: Number(result.diferencia.expected_cash),
      counted_cash: Number(result.diferencia.counted_cash),
      difference: Number(result.diferencia.difference),
      categoria: result.diferencia.categoria,
      observations: result.diferencia.observations,
      approved_by_label: result.diferencia.approved_by_label,
    },
  };
}

export async function anularMovimientoManual(
  id: number,
  ctx: AuthContext | undefined,
  motivo?: string,
) {
  const { pool } = await import("../../config/db.js");
  const mov = await repo.findMovimientoById(pool, id);
  if (!mov) {
    throw new AppError(404, "CAJA_MOVIMIENTO_NO_ENCONTRADO", "Movimiento no encontrado");
  }
  if (mov.source_type !== "MANUAL") {
    throw new AppError(
      400,
      "CAJA_TIPO_INVALIDO",
      "Solo se pueden anular movimientos MANUAL",
    );
  }
  if (mov.estado === "anulado") {
    throw new AppError(409, "CAJA_YA_ANULADO", "El movimiento ya está anulado");
  }

  const sesion = await repo.findSessionById(pool, mov.sesion_id);
  if (!sesion || sesion.estado !== "abierta") {
    throw new AppError(
      409,
      "CAJA_YA_CERRADA",
      "No se puede anular en una sesión cerrada",
    );
  }

  const row = await withTransaction(async (client) =>
    repo.anularMovimiento(client, id, actorLabel(ctx), motivo),
  );
  return mapMovimiento(row);
}

/**
 * Resolve session for a sale. Used by processSale.
 * Returns null if no session and require is off (legacy escape).
 */
export async function resolveSesionForSale(opts: {
  caja_sesion_id?: number | null;
  puesto?: string;
  sincronizada_offline?: boolean;
  requireSession: boolean;
}): Promise<{
  sesion_id: number;
  post_cierre_offline: boolean;
} | null> {
  const { pool } = await import("../../config/db.js");
  const puesto = opts.puesto ?? DEFAULT_PUESTO;

  if (opts.caja_sesion_id) {
    const sesion = await repo.findSessionById(pool, opts.caja_sesion_id);
    if (!sesion) {
      if (opts.requireSession) {
        throw new AppError(409, "CAJA_SIN_SESION", "Sesión de caja no encontrada");
      }
      return null;
    }
    if (sesion.estado === "abierta") {
      return { sesion_id: sesion.id, post_cierre_offline: false };
    }
    // cerrada / cancelada
    if (opts.sincronizada_offline) {
      console.warn(
        `[CAJA] Sync offline post-cierre: venta contra sesión ${sesion.id} (${sesion.estado})`,
      );
      return { sesion_id: sesion.id, post_cierre_offline: true };
    }
    throw new AppError(409, "CAJA_YA_CERRADA", "La sesión de caja ya está cerrada", {
      sesion_id: sesion.id,
    });
  }

  const open = await repo.findOpenSessionByPuesto(pool, puesto);
  if (open) {
    return { sesion_id: open.id, post_cierre_offline: false };
  }

  if (opts.requireSession) {
    throw new AppError(409, "CAJA_SIN_SESION", "No hay sesión de caja abierta", {
      puesto,
    });
  }
  return null;
}

export { ensureSaleMovimiento } from "./repository.js";
