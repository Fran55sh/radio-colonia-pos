import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../middleware/errors.js";
import type { FacturaPersistida } from "./representacion/modelo.js";

const cargarFacturaPersistida = vi.hoisted(() => vi.fn());
const renderFacturaPdf = vi.hoisted(() => vi.fn(async () => Buffer.from("%PDF-test")));
const enviarFacturaEmail = vi.hoisted(() => vi.fn());
const registrarDistribucion = vi.hoisted(() => vi.fn());
const leerEmailConfig = vi.hoisted(() => vi.fn());

vi.mock("./factura-datos.js", () => ({ cargarFacturaPersistida }));
vi.mock("./representacion/pdf.js", () => ({
  renderFacturaPdf,
  TEXTO_COMPROBANTE_AUTORIZADO: "Comprobante Autorizado",
  TEXTO_RESPONSABILIDAD: "",
  TEXTO_TRANSPARENCIA: "",
}));
vi.mock("./distribucion/registro.js", () => ({ registrarDistribucion }));
vi.mock("./distribucion/email.js", async () => {
  const actual = await vi.importActual<typeof import("./distribucion/email.js")>("./distribucion/email.js");
  return { ...actual, enviarFacturaEmail, leerEmailConfig };
});

import { enviarEmailDeVenta, pdfDeVenta } from "./factura-servicio.js";

function autorizada(partial: Partial<FacturaPersistida> = {}): FacturaPersistida {
  return {
    ventaId: 4,
    estado: "emitido",
    ambiente: "prod",
    emisorCuit: "20111111112",
    puntoVenta: 2,
    cbteTipo: 6,
    cbteNro: 1234,
    fechaCbte: "2026-10-17",
    cae: "71234567890123",
    caeVencimiento: "2026-10-27",
    qrUrl: "https://www.afip.gob.ar/fe/qr/?p=persistido",
    docTipo: 99,
    docNro: 0,
    condicionIvaReceptorId: 5,
    netoGravado: 82.64,
    ivaTotal: 17.36,
    exento: 0,
    total: 100,
    impTotalEnviado: 100,
    ivaDetalle: [{ id: 5, base: 82.64, importe: 17.36 }],
    moneda: "PES",
    cotizacion: 1,
    impTrib: 0,
    concepto: 1,
    medioPago: "Efectivo",
    receptor: {
      nombre: "Ada",
      razonSocial: null,
      domicilio: null,
      email: "ada@cliente.test",
      telefono: "5491112345678",
    },
    lineas: [
      {
        codigo: "SKU",
        descripcion: "Item",
        cantidad: 1,
        precioUnitario: 100,
        alicuota: 21,
        neto: 82.64,
        iva: 17.36,
        exento: 0,
        total: 100,
      },
    ],
    ...partial,
  };
}

describe("pdfDeVenta", () => {
  beforeEach(() => {
    cargarFacturaPersistida.mockReset();
    renderFacturaPdf.mockClear();
    enviarFacturaEmail.mockReset();
    registrarDistribucion.mockReset();
    leerEmailConfig.mockReset();
  });

  it("no importa la emisión fiscal", () => {
    const src = readFileSync(new URL("./factura-servicio.ts", import.meta.url), "utf8");
    expect(src.includes("emitirComprobante")).toBe(false);
    expect(src.includes("reintentarComprobante")).toBe(false);
    expect(src.includes("crearFactura")).toBe(false);
  });

  it("arma el PDF dos veces con el mismo nombre y no toca una rechazada", async () => {
    cargarFacturaPersistida.mockResolvedValue(autorizada());
    const first = await pdfDeVenta(4);
    const second = await pdfDeVenta(4);
    expect(first.filename).toBe("Factura-B-0002-00001234.pdf");
    expect(second.filename).toBe(first.filename);
    expect(renderFacturaPdf).toHaveBeenCalledTimes(2);
    expect(first.buffer.equals(second.buffer)).toBe(true);

    renderFacturaPdf.mockClear();
    cargarFacturaPersistida.mockResolvedValue(autorizada({ estado: "rechazado", cae: null }));
    await expect(pdfDeVenta(4)).rejects.toBeInstanceOf(AppError);
    expect(renderFacturaPdf).not.toHaveBeenCalled();
  });

  it("registra el fallo de email sin reenviar la factura a ARCA", async () => {
    cargarFacturaPersistida.mockResolvedValue(autorizada());
    leerEmailConfig.mockReturnValue({
      host: "smtp.test",
      port: 587,
      secure: false,
      user: "facturas",
      pass: "supersecret",
      from: "a@b.c",
      subjectTemplate: "Factura {{numero}}",
      bodyTemplate: "CAE {{cae}}",
    });
    enviarFacturaEmail.mockRejectedValue(new Error("fallo de transporte"));
    await expect(enviarEmailDeVenta(4, { to: "ada@cliente.test" })).rejects.toMatchObject({
      code: "EMAIL_FALLO",
    });
    expect(registrarDistribucion).toHaveBeenCalledWith(
      expect.objectContaining({
        ventaId: 4,
        canal: "email",
        resultado: "error",
        destino: "a***@cliente.test",
      }),
    );
    const logged = JSON.stringify(registrarDistribucion.mock.calls);
    expect(logged.includes("supersecret")).toBe(false);
    expect(renderFacturaPdf).toHaveBeenCalledTimes(1);
  });

  it("avisa cuando el correo no está configurado", async () => {
    cargarFacturaPersistida.mockResolvedValue(autorizada());
    leerEmailConfig.mockReturnValue(null);
    await expect(enviarEmailDeVenta(4, { to: "ada@cliente.test" })).rejects.toMatchObject({
      code: "EMAIL_NO_CONFIGURADO",
    });
    expect(enviarFacturaEmail).not.toHaveBeenCalled();
  });
});
