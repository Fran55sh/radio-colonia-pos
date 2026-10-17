import { describe, expect, it } from "vitest";
import { AppError } from "../../middleware/errors.js";
import { calcularImportesVenta } from "../../lib/fiscal-importes.js";
import {
  buildFECAEDetRequest,
  buildQrUrl,
  formatComprobanteNumero,
  mapAlicuotaToIvaTipo,
  parseFECAESolicitar,
} from "./mappers.js";

describe("mapAlicuotaToIvaTipo", () => {
  it("maps known rates", () => {
    expect(mapAlicuotaToIvaTipo(21)).toBeTruthy();
    expect(mapAlicuotaToIvaTipo(10.5)).toBeTruthy();
    expect(mapAlicuotaToIvaTipo(0)).toBeTruthy();
  });

  it("throws AppError for unsupported rate", () => {
    expect(() => mapAlicuotaToIvaTipo(99)).toThrow(AppError);
  });
});

describe("buildFECAEDetRequest", () => {
  it("arma Factura B consumidor final, Factura A RI y Factura A monotributo", () => {
    const importes = calcularImportesVenta([
      { orden: 0, cantidad: 1, precio_unitario: 100, alicuota: 21 },
    ]);
    const base = {
      cbteNro: 1,
      cbteFch: "20261017",
      importes,
    };
    expect(buildFECAEDetRequest({ ...base, docTipo: 99, docNro: 0, condicionIva: 5 })).toMatchObject({
      DocTipo: 99,
      DocNro: 0,
      CondicionIVAReceptorId: 5,
      ImpTotal: 100,
      ImpNeto: 82.64,
      ImpIVA: 17.36,
      Iva: [{ Id: 5, BaseImp: 82.64, Importe: 17.36 }],
    });
    expect(buildFECAEDetRequest({ ...base, docTipo: 80, docNro: 20111111112, condicionIva: 1 })).toMatchObject({
      DocTipo: 80,
      CondicionIVAReceptorId: 1,
    });
    expect(buildFECAEDetRequest({ ...base, docTipo: 80, docNro: 20111111112, condicionIva: 6 })).toMatchObject({
      CondicionIVAReceptorId: 6,
      ImpIVA: 17.36,
    });
  });

  it("el QR usa el ImpTotal y la fecha enviados", () => {
    const url = buildQrUrl(null, {
      fecha: "2026-10-17",
      cuit: 20111111112,
      ptoVta: 1,
      cbteTipo: 6,
      cbteNro: 8,
      total: 100,
      docTipo: 99,
      docNro: 0,
      cae: "71234567890123",
    });
    const payload = JSON.parse(Buffer.from(url.split("p=")[1], "base64").toString("utf8"));
    expect(payload.importe).toBe(100);
    expect(payload.fecha).toBe("2026-10-17");
  });
});

describe("parseFECAESolicitar", () => {
  it("lee un aprobado y un rechazado", () => {
    const approved = parseFECAESolicitar({
      FeCabResp: {
        Cuit: 1, PtoVta: 1, CbteTipo: 6, FchProceso: "", CantReg: 1, Resultado: "A", Reproceso: "N",
      },
      FeDetResp: {
        FECAEDetResponse: {
          Concepto: 1, DocTipo: 99, DocNro: 0, CbteDesde: 4, CbteHasta: 4, CbteFch: "20261017",
          Resultado: "A", CAE: "123", CAEFchVto: "20261231",
        },
      },
    });
    expect(approved).toMatchObject({ aprobada: true, cae: "123", cbteNro: 4 });

    const rejected = parseFECAESolicitar({
      FeCabResp: {
        Cuit: 1, PtoVta: 1, CbteTipo: 6, FchProceso: "", CantReg: 1, Resultado: "R", Reproceso: "N",
      },
      FeDetResp: {
        FECAEDetResponse: {
          Concepto: 1, DocTipo: 99, DocNro: 0, CbteDesde: 4, CbteHasta: 4, CbteFch: "20261017",
          Resultado: "R", CAE: "", CAEFchVto: "",
          Observaciones: { Obs: { Code: 10048, Msg: "rechazo" } },
        },
      },
    });
    expect(rejected.aprobada).toBe(false);
    expect(rejected.observaciones[0]?.code).toBe(10048);
  });
});

describe("formatComprobanteNumero", () => {
  it("formats PV and number", () => {
    const formatted = formatComprobanteNumero(1, 6, 42);
    expect(formatted).toMatch(/0001/);
    expect(formatted).toMatch(/00000042/);
  });

  it("labels NC/ND with the same letter as the original", () => {
    expect(formatComprobanteNumero(1, 3, 1)).toMatch(/NotadeCréditoA/);
    expect(formatComprobanteNumero(1, 2, 1)).toMatch(/NotadeDébitoA/);
    expect(formatComprobanteNumero(1, 8, 1)).toMatch(/NotadeCréditoB/);
    expect(formatComprobanteNumero(1, 7, 1)).toMatch(/NotadeDébitoB/);
  });
});
