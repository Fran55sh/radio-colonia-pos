import { describe, expect, it } from "vitest";
import { CbteTipo } from "@ramiidv/arca-facturacion";
import { AppError } from "../../../middleware/errors.js";
import type { EmisorPresentacion } from "./emisor.js";
import { formatImporte } from "./formato.js";
import { armarRepresentacion, type FacturaPersistida } from "./modelo.js";

const emisor: EmisorPresentacion = {
  razonSocial: "Radio Colonia",
  domicilio: "Calle 1 123, Colonia",
  condicionIva: "IVA Responsable Inscripto",
  ingresosBrutos: "901-000",
  inicioActividades: "2010-05-01",
};

function factura(partial: Partial<FacturaPersistida> = {}): FacturaPersistida {
  return {
    ventaId: 10,
    estado: "emitido",
    ambiente: "prod",
    emisorCuit: "20111111112",
    puntoVenta: 2,
    cbteTipo: CbteTipo.FACTURA_B,
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
    receptor: null,
    lineas: [
      {
        codigo: "SKU-1",
        descripcion: "Radio portatil",
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

describe("armarRepresentacion", () => {
  it("nombra Factura B y usa el QR y el total persistidos", () => {
    const model = armarRepresentacion(factura(), emisor);
    expect(model.archivo).toBe("Factura-B-0002-00001234.pdf");
    expect(model.letra).toBe("B");
    expect(model.codigo).toBe("06");
    expect(model.qrUrl).toBe("https://www.afip.gob.ar/fe/qr/?p=persistido");
    expect(model.totales.total).toBe(formatImporte(100));
    expect(model.totales.netoGravado).toBeNull();
    expect(model.transparencia?.iva[0]?.importe).toBe(formatImporte(17.36));
    expect(model.transparencia?.otrosImpuestos).toBe(formatImporte(0));
    expect(model.receptor.leyendaConsumidorFinal).toBe(true);
    expect(model.receptor.nombre).toBe("Consumidor Final");
    expect(model.lineas[0]?.bonificacion).toBe("—");
    expect(model.lineas[0]?.unidad).toBe("unidades");
    expect(model.lineas[0]?.importe).toBe(formatImporte(100));
    expect(model.emisor.cuit).toBe("20-11111111-2");
  });

  it("Factura A discrimina el IVA persistido y no arma el recuadro de transparencia", () => {
    const model = armarRepresentacion(
      factura({
        cbteTipo: CbteTipo.FACTURA_A,
        docTipo: 80,
        docNro: 20123456786,
        condicionIvaReceptorId: 1,
        netoGravado: 20.01,
        ivaTotal: 4.2,
        total: 24.21,
        impTotalEnviado: 24.21,
        ivaDetalle: [
          { id: 5, base: 10, importe: 2.1 },
          { id: 4, base: 10.01, importe: 2.1 },
        ],
        moneda: "DOL",
        cotizacion: 65,
        receptor: {
          nombre: "Caja",
          razonSocial: "ACME SA",
          domicilio: "Mitre 50",
          email: "facturas@acme.test",
          telefono: "5491112345678",
        },
        lineas: [
          {
            codigo: "A1",
            descripcion: "Item 21",
            cantidad: 2,
            precioUnitario: 50,
            alicuota: 21,
            neto: 10,
            iva: 2.1,
            exento: 0,
            total: 12.1,
          },
          {
            codigo: "A2",
            descripcion: "Item 10.5",
            cantidad: 1,
            precioUnitario: 12.11,
            alicuota: 10.5,
            neto: 10.01,
            iva: 2.1,
            exento: 0,
            total: 12.11,
          },
        ],
      }),
      emisor,
    );
    expect(model.archivo).toBe("Factura-A-0002-00001234.pdf");
    expect(model.codigo).toBe("01");
    expect(model.discriminaIva).toBe(true);
    expect(model.transparencia).toBeNull();
    expect(model.totales.netoGravado).toBe(formatImporte(20.01));
    expect(model.totales.iva.map((row) => row.etiqueta)).toEqual(["IVA 21%", "IVA 10,5%"]);
    expect(model.totales.iva.map((row) => row.importe)).toEqual([formatImporte(2.1), formatImporte(2.1)]);
    expect(model.totales.total).toBe(formatImporte(24.21));
    expect(model.lineas[0]?.importe).toBe(formatImporte(10));
    expect(model.lineas[0]?.precioUnitario).toBe(formatImporte(5));
    expect(model.moneda).toBe("DOL");
    expect(model.cotizacion).toBe("65");
    expect(model.receptor.nombre).toBe("ACME SA");
    expect(model.receptor.documento).toContain("20-12345678-6");
    expect(model.receptor.leyendaConsumidorFinal).toBe(false);
  });

  it("Factura C no discrimina IVA y muestra transparencia con el IVA persistido", () => {
    const model = armarRepresentacion(
      factura({
        cbteTipo: CbteTipo.FACTURA_C,
        ivaDetalle: [],
        ivaTotal: 0,
        netoGravado: 0,
        total: 80,
        impTotalEnviado: 80,
        lineas: [
          {
            codigo: "C1",
            descripcion: "Servicio",
            cantidad: 1,
            precioUnitario: 80,
            alicuota: 0,
            neto: 0,
            iva: 0,
            exento: 0,
            total: 80,
          },
        ],
      }),
      emisor,
    );
    expect(model.letra).toBe("C");
    expect(model.codigo).toBe("11");
    expect(model.archivo).toBe("Factura-C-0002-00001234.pdf");
    expect(model.discriminaIva).toBe(false);
    expect(model.totales.netoGravado).toBeNull();
    expect(model.totales.iva).toEqual([]);
    expect(model.transparencia?.iva).toEqual([
      { etiqueta: "IVA Contenido", importe: formatImporte(0) },
    ]);
    expect(model.lineas[0]?.importe).toBe(formatImporte(80));
  });

  it("si falta el QR lo reconstruye con el importe persistido, no con un recálculo", () => {
    const model = armarRepresentacion(
      factura({ qrUrl: null, impTotalEnviado: 100.01, total: 100 }),
      emisor,
    );
    const payload = JSON.parse(Buffer.from(model.qrUrl.split("p=")[1], "base64").toString("utf8")) as {
      importe: number;
      codAut: number;
      moneda: string;
    };
    expect(payload.importe).toBe(100.01);
    expect(payload.codAut).toBe(71234567890123);
    expect(payload.moneda).toBe("PES");
  });

  it("rechaza pendientes, rechazadas, CAE corto y anuladas", () => {
    expect(() => armarRepresentacion(factura({ estado: "pendiente", cae: null }), emisor)).toThrow(AppError);
    expect(() => armarRepresentacion(factura({ estado: "rechazado", cae: null }), emisor)).toThrow(/rechazó/);
    expect(() => armarRepresentacion(factura({ estado: "emitido", cae: "123" }), emisor)).toThrow(/CAE/);
    expect(() => armarRepresentacion(factura({ estado: "anulado" }), emisor)).toThrow(/anulada/);
    expect(() => armarRepresentacion(factura({ estado: "desconocido", cae: null }), emisor)).toThrow(/confirmación/);
  });

  it("el neto de cabecera no se reemplaza por la suma de las líneas", () => {
    const model = armarRepresentacion(
      factura({
        cbteTipo: CbteTipo.FACTURA_A,
        docTipo: 80,
        docNro: 20123456786,
        condicionIvaReceptorId: 1,
        netoGravado: 20.01,
        lineas: [
          {
            codigo: "X",
            descripcion: "Desfasado",
            cantidad: 1,
            precioUnitario: 10,
            alicuota: 21,
            neto: 10,
            iva: 2.1,
            exento: 0,
            total: 12.1,
          },
        ],
      }),
      emisor,
    );
    expect(model.totales.netoGravado).toBe(formatImporte(20.01));
    expect(model.lineas[0]?.importe).toBe(formatImporte(10));
  });
});
