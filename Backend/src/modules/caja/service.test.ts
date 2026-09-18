import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findOpenSessionByPuesto,
  findSessionById,
  listOpeningBalances,
  sumActiveMovimientos,
  insertMovimiento,
  closeSession,
  insertDiferencia,
  findMovimientoById,
  anularMovimiento,
  insertSession,
  insertOpeningBalances,
  findDiferenciaBySesion,
  listMovimientos,
} = vi.hoisted(() => ({
  findOpenSessionByPuesto: vi.fn(),
  findSessionById: vi.fn(),
  listOpeningBalances: vi.fn(),
  sumActiveMovimientos: vi.fn(),
  insertMovimiento: vi.fn(),
  closeSession: vi.fn(),
  insertDiferencia: vi.fn(),
  findMovimientoById: vi.fn(),
  anularMovimiento: vi.fn(),
  insertSession: vi.fn(),
  insertOpeningBalances: vi.fn(),
  findDiferenciaBySesion: vi.fn(),
  listMovimientos: vi.fn(),
}));

vi.mock("./repository.js", () => ({
  findOpenSessionByPuesto,
  findSessionById,
  listOpeningBalances,
  sumActiveMovimientos,
  insertMovimiento,
  closeSession,
  insertDiferencia,
  findMovimientoById,
  anularMovimiento,
  insertSession,
  insertOpeningBalances,
  findDiferenciaBySesion,
  listMovimientos,
  ensureSaleMovimiento: vi.fn(),
}));

vi.mock("../../config/db.js", () => ({
  pool: { query: vi.fn() },
  withTransaction: vi.fn(async (fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: vi.fn() }),
  ),
}));

const assertAdminPin = vi.hoisted(() => vi.fn());
vi.mock("../auth/service.js", () => ({
  assertAdminPin,
}));

import { AppError } from "../../middleware/errors.js";
import {
  computeExpectedCash,
  crearMovimientoManual,
  cerrarSesion,
  resolveSesionForSale,
} from "./service.js";

describe("computeExpectedCash", () => {
  it("suma opening + ingresos efectivo − egresos efectivo", () => {
    expect(
      computeExpectedCash({
        openingEfectivo: 1000,
        movimientos: [
          { payment_method: "Efectivo", direccion: "ingreso", amount: 500 },
          { payment_method: "Efectivo", direccion: "egreso", amount: 200 },
          { payment_method: "Débito/Crédito", direccion: "ingreso", amount: 999 },
        ],
      }),
    ).toBe(1300);
  });

  it("ignora movimientos anulados", () => {
    expect(
      computeExpectedCash({
        openingEfectivo: 100,
        movimientos: [
          {
            payment_method: "Efectivo",
            direccion: "egreso",
            amount: 50,
            estado: "anulado",
          },
        ],
      }),
    ).toBe(100);
  });
});

describe("resolveSesionForSale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("devuelve sesión abierta por id", async () => {
    findSessionById.mockResolvedValue({
      id: 7,
      puesto: "Caja 01",
      estado: "abierta",
    });
    const r = await resolveSesionForSale({
      caja_sesion_id: 7,
      requireSession: true,
    });
    expect(r).toEqual({ sesion_id: 7, post_cierre_offline: false });
  });

  it("sesión cerrada online → CAJA_YA_CERRADA", async () => {
    findSessionById.mockResolvedValue({
      id: 7,
      puesto: "Caja 01",
      estado: "cerrada",
    });
    await expect(
      resolveSesionForSale({
        caja_sesion_id: 7,
        requireSession: true,
        sincronizada_offline: false,
      }),
    ).rejects.toMatchObject({ code: "CAJA_YA_CERRADA" });
  });

  it("sesión cerrada + offline-sync → post_cierre_offline", async () => {
    findSessionById.mockResolvedValue({
      id: 7,
      puesto: "Caja 01",
      estado: "cerrada",
    });
    const r = await resolveSesionForSale({
      caja_sesion_id: 7,
      requireSession: true,
      sincronizada_offline: true,
    });
    expect(r).toEqual({ sesion_id: 7, post_cierre_offline: true });
  });

  it("require on sin sesión → CAJA_SIN_SESION", async () => {
    findOpenSessionByPuesto.mockResolvedValue(null);
    await expect(
      resolveSesionForSale({ requireSession: true }),
    ).rejects.toMatchObject({ code: "CAJA_SIN_SESION" });
  });

  it("require off sin sesión → null (legacy)", async () => {
    findOpenSessionByPuesto.mockResolvedValue(null);
    const r = await resolveSesionForSale({ requireSession: false });
    expect(r).toBeNull();
  });
});

describe("crearMovimientoManual retiro", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findSessionById.mockResolvedValue({
      id: 1,
      puesto: "Caja 01",
      estado: "abierta",
    });
    listOpeningBalances.mockResolvedValue([
      { payment_method: "Efectivo", amount: "500" },
    ]);
    sumActiveMovimientos.mockResolvedValue([]);
    insertMovimiento.mockResolvedValue({
      id: 99,
      sesion_id: 1,
      occurred_at: new Date(),
      tipo: "retiro",
      direccion: "egreso",
      amount: "100",
      payment_method: "Efectivo",
      description: null,
      source_type: "MANUAL",
      source_id: null,
      created_by_label: "caja:jwt",
      approved_by_label: "admin:pin",
      estado: "activo",
      post_cierre_offline: false,
    });
  });

  it("retiro sin pin → CAJA_RETIRO_REQUIERE_ADMIN", async () => {
    await expect(
      crearMovimientoManual(
        {
          sesion_id: 1,
          tipo: "retiro",
          amount: 100,
          payment_method: "Efectivo",
        },
        { role: "caja", sub: "pos", via: "jwt" },
      ),
    ).rejects.toMatchObject({ code: "CAJA_RETIRO_REQUIERE_ADMIN" });
  });

  it("retiro con pin ok", async () => {
    assertAdminPin.mockImplementation(() => undefined);
    const result = await crearMovimientoManual(
      {
        sesion_id: 1,
        tipo: "retiro",
        amount: 100,
        payment_method: "Efectivo",
        admin_pin: "admin-pin",
      },
      { role: "caja", sub: "pos", via: "jwt" },
    );
    expect(assertAdminPin).toHaveBeenCalledWith("admin-pin");
    expect(result.movimiento.id).toBe(99);
  });

  it("retiro > esperado → warning", async () => {
    assertAdminPin.mockImplementation(() => undefined);
    const result = await crearMovimientoManual(
      {
        sesion_id: 1,
        tipo: "retiro",
        amount: 900,
        payment_method: "Efectivo",
        admin_pin: "admin-pin",
      },
      { role: "caja", sub: "pos", via: "jwt" },
    );
    expect(result.warning).toMatch(/mayor al efectivo/i);
  });
});

describe("cerrarSesion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findSessionById.mockResolvedValue({
      id: 1,
      puesto: "Caja 01",
      estado: "abierta",
    });
    listOpeningBalances.mockResolvedValue([
      { payment_method: "Efectivo", amount: "1000" },
    ]);
    sumActiveMovimientos.mockResolvedValue([]);
    closeSession.mockResolvedValue({
      id: 1,
      puesto: "Caja 01",
      estado: "cerrada",
      opened_at: new Date(),
      opened_by_label: "caja:jwt",
      closed_at: new Date(),
      closed_by_label: "caja:jwt",
      notes: null,
    });
    insertDiferencia.mockImplementation(async (_c, input) => ({
      id: 1,
      sesion_id: input.sesion_id,
      expected_cash: String(input.expected_cash),
      counted_cash: String(input.counted_cash),
      difference: String(input.difference),
      categoria: input.categoria ?? null,
      observations: input.observations ?? null,
      approved_by_label: input.approved_by_label ?? null,
    }));
    insertMovimiento.mockResolvedValue({
      id: 50,
      sesion_id: 1,
      occurred_at: new Date(),
      tipo: "gasto",
      direccion: "egreso",
      amount: "10",
      payment_method: "Efectivo",
      description: null,
      source_type: "SYSTEM",
      source_id: "diff-1",
      created_by_label: "caja:jwt",
      approved_by_label: "admin:pin",
      estado: "activo",
      post_cierre_offline: false,
    });
  });

  it("diff = 0 sin pin", async () => {
    const result = await cerrarSesion(
      1,
      { counted_cash: 1000 },
      { role: "caja", sub: "pos", via: "jwt" },
    );
    expect(result.diferencia.difference).toBe(0);
    expect(assertAdminPin).not.toHaveBeenCalled();
  });

  it("diff ≠ 0 sin pin → CAJA_DIFF_REQUIERE_ADMIN", async () => {
    await expect(
      cerrarSesion(
        1,
        { counted_cash: 990 },
        { role: "caja", sub: "pos", via: "jwt" },
      ),
    ).rejects.toMatchObject({ code: "CAJA_DIFF_REQUIERE_ADMIN" });
  });

  it("diff ≠ 0 con pin ok", async () => {
    assertAdminPin.mockImplementation(() => undefined);
    const result = await cerrarSesion(
      1,
      { counted_cash: 990, admin_pin: "admin" },
      { role: "caja", sub: "pos", via: "jwt" },
    );
    expect(result.diferencia.difference).toBe(-10);
    expect(assertAdminPin).toHaveBeenCalled();
  });
});

describe("assertAdminPin wiring", () => {
  it("propaga AppError de pin inválido", async () => {
    findSessionById.mockResolvedValue({
      id: 1,
      puesto: "Caja 01",
      estado: "abierta",
    });
    assertAdminPin.mockImplementation(() => {
      throw new AppError(403, "CAJA_PIN_INVALIDO", "PIN admin incorrecto");
    });
    await expect(
      crearMovimientoManual(
        {
          sesion_id: 1,
          tipo: "retiro",
          amount: 10,
          payment_method: "Efectivo",
          admin_pin: "wrong",
        },
        { role: "caja", sub: "pos", via: "jwt" },
      ),
    ).rejects.toMatchObject({ code: "CAJA_PIN_INVALIDO" });
  });
});
