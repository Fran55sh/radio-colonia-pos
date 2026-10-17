import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getComprobanteByVentaId,
  loadVentaFiscalContext,
  ensureComprobantePendiente,
  marcarComprobanteEmitido,
  marcarComprobanteError,
  rowToFiscalResponse,
  withVentaFiscalLock,
  getArcaClient,
  getArcaConfig,
  isArcaConfigured,
  resolverComprobante,
} = vi.hoisted(() => ({
  getComprobanteByVentaId: vi.fn(),
  loadVentaFiscalContext: vi.fn(),
  ensureComprobantePendiente: vi.fn(),
  marcarComprobanteEmitido: vi.fn(),
  marcarComprobanteError: vi.fn(),
  rowToFiscalResponse: vi.fn((row: unknown) => row),
  withVentaFiscalLock: vi.fn(async (_id: number, fn: () => Promise<unknown>) => fn()),
  getArcaClient: vi.fn(),
  getArcaConfig: vi.fn(),
  isArcaConfigured: vi.fn(),
  resolverComprobante: vi.fn(),
}));

vi.mock("./repository.js", () => ({
  getComprobanteByVentaId,
  loadVentaFiscalContext,
  ensureComprobantePendiente,
  marcarComprobanteEmitido,
  marcarComprobanteError,
  rowToFiscalResponse,
  withVentaFiscalLock,
}));

vi.mock("./arca-client.js", () => ({
  getArcaClient,
  resetArcaClientForTests: vi.fn(),
}));

vi.mock("../../config/arca.js", () => ({
  getArcaConfig,
  isArcaConfigured,
}));

vi.mock("./resolver.js", () => ({
  resolverComprobante,
}));

import { emitirComprobanteVenta, maybeEmitirDespuesDeVenta } from "./service.js";

function caeResponse(cae: string, nro: number) {
  return {
    FeCabResp: {
      Cuit: 20111111112,
      PtoVta: 1,
      CbteTipo: 6,
      FchProceso: "20261017",
      CantReg: 1,
      Resultado: "A" as const,
      Reproceso: "N",
    },
    FeDetResp: {
      FECAEDetResponse: {
        Concepto: 1,
        DocTipo: 99,
        DocNro: 0,
        CbteDesde: nro,
        CbteHasta: nro,
        CbteFch: "20261017",
        Resultado: "A" as const,
        CAE: cae,
        CAEFchVto: "20261231",
      },
    },
  };
}

describe("emitirComprobanteVenta idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withVentaFiscalLock.mockImplementation(async (_id: number, fn: () => Promise<unknown>) => fn());
    getArcaConfig.mockReturnValue({
      enabled: true,
      cuit: 20123456786,
      ptoVta: 1,
      production: false,
      cert: "CERT",
      key: "KEY",
      ambiente: "dev",
    });
    isArcaConfigured.mockReturnValue(true);
    loadVentaFiscalContext.mockResolvedValue({
      venta_id: 10,
      cliente_id: null,
      neto_gravado: 100,
      iva_total: 21,
      exento: 0,
      total: 121,
      lineas: [{
        orden: 0,
        cantidad: 1,
        precio_unitario: 121,
        neto_linea: 100,
        iva_linea: 21,
        exento_linea: 0,
        alicuota_iva: 21,
      }],
      cliente: null,
    });
    resolverComprobante.mockReturnValue({
      cbteTipo: 6,
      docTipo: 99,
      docNro: 0,
      condicionIva: 5,
      label: "Factura B",
    });
  });

  it("does not call WSFE when already emitido with CAE", async () => {
    const existing = {
      estado: "emitido",
      cae: "12345678901234",
      ambiente: "dev",
    };
    getComprobanteByVentaId.mockResolvedValue(existing);
    rowToFiscalResponse.mockReturnValue({ estado: "emitido", cae: existing.cae });

    const crearFactura = vi.fn();
    const ultimoComprobante = vi.fn();
    getArcaClient.mockReturnValue({ crearFactura, ultimoComprobante });

    const result = await emitirComprobanteVenta(10);
    expect(result).toMatchObject({ estado: "emitido", cae: "12345678901234" });
    expect(crearFactura).not.toHaveBeenCalled();
    expect(withVentaFiscalLock).toHaveBeenCalledWith(10, expect.any(Function));
  });

  it("pide CAE con importes explícitos cuando está pendiente", async () => {
    getComprobanteByVentaId
      .mockResolvedValueOnce({ estado: "pendiente", cae: null })
      .mockResolvedValue({
        estado: "emitido",
        cae: "999",
        cbte_nro: 7,
        ambiente: "dev",
      });
    ensureComprobantePendiente.mockResolvedValue({ estado: "pendiente" });
    const crearFactura = vi.fn().mockResolvedValue(caeResponse("999", 7));
    const ultimoComprobante = vi.fn().mockResolvedValue(6);
    getArcaClient.mockReturnValue({ crearFactura, ultimoComprobante });
    rowToFiscalResponse.mockImplementation((row: { estado: string; cae: string }) => row);

    await emitirComprobanteVenta(10);
    expect(crearFactura).toHaveBeenCalledOnce();
    expect(crearFactura.mock.calls[0][0].invoices[0]).toMatchObject({
      CbteDesde: 7,
      ImpTotal: 121,
      ImpNeto: 100,
      ImpIVA: 21,
      Iva: [{ Id: 5, BaseImp: 100, Importe: 21 }],
    });
    expect(marcarComprobanteEmitido).toHaveBeenCalled();
  });

  it("envía Factura A a ARCA con DocTipo 80, CondicionIVAReceptorId de monotributo e IVA discriminado", async () => {
    resolverComprobante.mockReturnValue({
      cbteTipo: 1,
      docTipo: 80,
      docNro: 20123456786,
      condicionIva: 6,
      label: "Factura A — Monotributo",
    });
    getComprobanteByVentaId
      .mockResolvedValueOnce({ estado: "pendiente", cae: null })
      .mockResolvedValue({
        estado: "emitido",
        cae: "111",
        cbte_nro: 3,
        ambiente: "dev",
      });
    ensureComprobantePendiente.mockResolvedValue({ estado: "pendiente" });
    const crearFactura = vi.fn().mockResolvedValue(caeResponse("111", 1));
    const ultimoComprobante = vi.fn().mockResolvedValue(0);
    getArcaClient.mockReturnValue({ crearFactura, ultimoComprobante });
    rowToFiscalResponse.mockImplementation((row: { estado: string; cae: string }) => row);

    await emitirComprobanteVenta(10);

    expect(crearFactura).toHaveBeenCalledWith(
      expect.objectContaining({
        CbteTipo: 1,
        invoices: [
          expect.objectContaining({
            DocTipo: 80,
            DocNro: 20123456786,
            CondicionIVAReceptorId: 6,
            ImpNeto: 100,
            ImpIVA: 21,
            Iva: [{ Id: 5, BaseImp: 100, Importe: 21 }],
          }),
        ],
      }),
    );
  });

  it("trata como emitido un comprobante con CAE aunque el estado sea error", async () => {
    getComprobanteByVentaId.mockResolvedValue({
      estado: "error",
      cae: "555",
      ambiente: "dev",
    });
    rowToFiscalResponse.mockReturnValue({ estado: "error", cae: "555" });
    const crearFactura = vi.fn();
    getArcaClient.mockReturnValue({ crearFactura });

    const result = await emitirComprobanteVenta(10, { forceRetry: true });
    expect(result).toMatchObject({ estado: "emitido", cae: "555" });
    expect(crearFactura).not.toHaveBeenCalled();
    expect(marcarComprobanteError).not.toHaveBeenCalled();
  });

  it("marca error si los importes no cierran con el total", async () => {
    loadVentaFiscalContext.mockResolvedValue({
      venta_id: 10,
      cliente_id: null,
      neto_gravado: 100,
      iva_total: 21,
      exento: 0,
      total: 50,
      lineas: [{
        orden: 0,
        cantidad: 1,
        precio_unitario: 121,
        neto_linea: 100,
        iva_linea: 21,
        exento_linea: 0,
        alicuota_iva: 21,
      }],
      cliente: null,
    });
    getComprobanteByVentaId.mockResolvedValue({ estado: "pendiente", cae: null });
    ensureComprobantePendiente.mockResolvedValue({ estado: "pendiente" });
    const crearFactura = vi.fn();
    getArcaClient.mockReturnValue({ crearFactura, ultimoComprobante: vi.fn() });
    rowToFiscalResponse.mockReturnValue({ estado: "error", cae: null });

    await emitirComprobanteVenta(10);
    expect(crearFactura).not.toHaveBeenCalled();
    expect(marcarComprobanteError).toHaveBeenCalledWith(
      10,
      "IMPORTES_INCONSISTENTES",
      expect.any(String),
      expect.any(Error),
    );
  });

  it("no marca error si la persistencia falla despues del CAE", async () => {
    getComprobanteByVentaId.mockResolvedValue({ estado: "pendiente", cae: null, ambiente: "dev" });
    ensureComprobantePendiente.mockResolvedValue({ estado: "pendiente" });
    marcarComprobanteEmitido.mockRejectedValue(new Error("db caida"));
    const crearFactura = vi.fn().mockResolvedValue(caeResponse("777", 4));
    getArcaClient.mockReturnValue({
      crearFactura,
      ultimoComprobante: vi.fn().mockResolvedValue(3),
    });

    const result = await emitirComprobanteVenta(10);
    expect(crearFactura).toHaveBeenCalledOnce();
    expect(marcarComprobanteEmitido).toHaveBeenCalledTimes(3);
    expect(marcarComprobanteError).not.toHaveBeenCalled();
    expect(result).toMatchObject({ estado: "emitido", cae: "777" });
  });

  it("maybeEmitirDespuesDeVenta skips when skipFiscal", async () => {
    const result = await maybeEmitirDespuesDeVenta(10, { skipFiscal: true });
    expect(result).toBeNull();
    expect(getArcaConfig).not.toHaveBeenCalled();
  });
});
