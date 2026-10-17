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
  lineasToArcaItems,
  buildQrUrl,
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
  lineasToArcaItems: vi.fn(),
  buildQrUrl: vi.fn(() => "https://qr.example/test"),
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

vi.mock("./mappers.js", () => ({
  lineasToArcaItems,
  buildQrUrl,
  formatComprobanteNumero: vi.fn(),
  cbteTipoLabel: vi.fn(),
  mapAlicuotaToIvaTipo: vi.fn(),
}));

import { emitirComprobanteVenta, maybeEmitirDespuesDeVenta } from "./service.js";

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
      lineas: [{ neto_linea: 100, iva_linea: 21, exento_linea: 0, alicuota_iva: 21 }],
      cliente: null,
    });
    resolverComprobante.mockReturnValue({
      cbteTipo: 6,
      docTipo: 99,
      docNro: 0,
      condicionIva: 5,
      label: "Factura B",
    });
    lineasToArcaItems.mockReturnValue([{ neto: 100, iva: 5 }]);
  });

  it("does not call WSFE when already emitido with CAE", async () => {
    const existing = {
      estado: "emitido",
      cae: "12345678901234",
      ambiente: "dev",
    };
    getComprobanteByVentaId.mockResolvedValue(existing);
    rowToFiscalResponse.mockReturnValue({ estado: "emitido", cae: existing.cae });

    const facturar = vi.fn();
    getArcaClient.mockReturnValue({ facturar });

    const result = await emitirComprobanteVenta(10);
    expect(result).toMatchObject({ estado: "emitido", cae: "12345678901234" });
    expect(facturar).not.toHaveBeenCalled();
    expect(withVentaFiscalLock).toHaveBeenCalledWith(10, expect.any(Function));
  });

  it("calls facturar when pendiente", async () => {
    getComprobanteByVentaId
      .mockResolvedValueOnce({ estado: "pendiente", cae: null })
      .mockResolvedValue({
        estado: "emitido",
        cae: "999",
        cbte_nro: 7,
        ambiente: "dev",
      });
    ensureComprobantePendiente.mockResolvedValue({ estado: "pendiente" });
    const facturar = vi.fn().mockResolvedValue({
      aprobada: true,
      cae: "999",
      cbteNro: 7,
      caeVencimiento: "20261231",
    });
    getArcaClient.mockReturnValue({ facturar });
    rowToFiscalResponse.mockImplementation((row: { estado: string; cae: string }) => row);

    await emitirComprobanteVenta(10);
    expect(facturar).toHaveBeenCalledOnce();
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
    lineasToArcaItems.mockReturnValue([{ neto: 100, iva: 5 }]);
    getComprobanteByVentaId
      .mockResolvedValueOnce({ estado: "pendiente", cae: null })
      .mockResolvedValue({
        estado: "emitido",
        cae: "111",
        cbte_nro: 3,
        ambiente: "dev",
      });
    ensureComprobantePendiente.mockResolvedValue({ estado: "pendiente" });
    const facturar = vi.fn().mockResolvedValue({
      aprobada: true,
      cae: "111",
      cbteNro: 3,
      caeVencimiento: "20261231",
    });
    getArcaClient.mockReturnValue({ facturar });
    rowToFiscalResponse.mockImplementation((row: { estado: string; cae: string }) => row);

    await emitirComprobanteVenta(10);

    expect(facturar).toHaveBeenCalledWith(
      expect.objectContaining({
        cbteTipo: 1,
        docTipo: 80,
        docNro: 20123456786,
        condicionIva: 6,
        items: [{ neto: 100, iva: 5 }],
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
    const facturar = vi.fn();
    getArcaClient.mockReturnValue({ facturar });

    const result = await emitirComprobanteVenta(10, { forceRetry: true });
    expect(result).toMatchObject({ estado: "emitido", cae: "555" });
    expect(facturar).not.toHaveBeenCalled();
    expect(marcarComprobanteError).not.toHaveBeenCalled();
  });

  it("marca error si lineasToArcaItems falla antes de facturar", async () => {
    getComprobanteByVentaId.mockResolvedValue({ estado: "pendiente", cae: null });
    ensureComprobantePendiente.mockResolvedValue({ estado: "pendiente" });
    lineasToArcaItems.mockImplementation(() => {
      throw new Error("sin importes");
    });
    const facturar = vi.fn();
    getArcaClient.mockReturnValue({ facturar });
    rowToFiscalResponse.mockReturnValue({ estado: "error", cae: null });

    await emitirComprobanteVenta(10);
    expect(facturar).not.toHaveBeenCalled();
    expect(marcarComprobanteError).toHaveBeenCalledWith(
      10,
      "ARCA_ERROR",
      "sin importes",
      expect.any(Error),
    );
  });

  it("no marca error si la persistencia falla despues del CAE", async () => {
    getComprobanteByVentaId.mockResolvedValue({ estado: "pendiente", cae: null, ambiente: "dev" });
    ensureComprobantePendiente.mockResolvedValue({ estado: "pendiente" });
    marcarComprobanteEmitido.mockRejectedValue(new Error("db caida"));
    const facturar = vi.fn().mockResolvedValue({
      aprobada: true,
      cae: "777",
      cbteNro: 4,
      caeVencimiento: "20261231",
    });
    getArcaClient.mockReturnValue({ facturar });

    const result = await emitirComprobanteVenta(10);
    expect(facturar).toHaveBeenCalledOnce();
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
