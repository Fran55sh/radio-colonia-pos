import { Arca, CbteTipo, DocTipo, IvaTipo, type FECAESolicitarResult, type InvoiceDetail } from "@ramiidv/arca-facturacion";
import { AppError } from "../../middleware/errors.js";
import {
  moneyFromCents,
  type ImportesVenta,
} from "../../lib/fiscal-importes.js";

const ALICUOTA_MAP: Record<number, IvaTipo> = {
  21: IvaTipo.IVA_21,
  10.5: IvaTipo.IVA_10_5,
  27: IvaTipo.IVA_27,
  5: IvaTipo.IVA_5,
  2.5: IvaTipo.IVA_2_5,
  0: IvaTipo.IVA_0,
};

export function mapAlicuotaToIvaTipo(alicuota: number): IvaTipo {
  const tipo = ALICUOTA_MAP[alicuota];
  if (!tipo) {
    throw new AppError(
      400,
      "ALICUOTA_NO_SOPORTADA",
      `Alícuota IVA ${alicuota}% no soportada para facturación ARCA`,
    );
  }
  return tipo;
}

export type ParsedFECAE = {
  aprobada: boolean;
  resultado: "A" | "R";
  cae?: string;
  caeVencimiento?: string;
  cbteNro: number;
  observaciones: Array<{ code: number; msg: string }>;
};

export function buildFECAEDetRequest(input: {
  cbteNro: number;
  cbteFch: string;
  docTipo: number;
  docNro: number;
  condicionIva: number;
  importes: ImportesVenta;
}): InvoiceDetail {
  const iva = input.importes.grupos
    .filter((grupo) => grupo.alicuota > 0 && (grupo.neto_cents > 0 || grupo.iva_cents > 0))
    .map((grupo) => ({
      Id: mapAlicuotaToIvaTipo(grupo.alicuota),
      BaseImp: moneyFromCents(grupo.neto_cents),
      Importe: moneyFromCents(grupo.iva_cents),
    }));

  const detail: InvoiceDetail = {
    Concepto: 1,
    DocTipo: input.docTipo,
    DocNro: input.docNro,
    CbteDesde: input.cbteNro,
    CbteHasta: input.cbteNro,
    CbteFch: input.cbteFch,
    ImpTotal: moneyFromCents(input.importes.total_cents),
    ImpTotConc: moneyFromCents(input.importes.imp_tot_conc_cents),
    ImpNeto: moneyFromCents(input.importes.neto_cents),
    ImpOpEx: moneyFromCents(input.importes.exento_cents),
    ImpTrib: 0,
    ImpIVA: moneyFromCents(input.importes.iva_cents),
    MonId: "PES",
    MonCotiz: 1,
    CondicionIVAReceptorId: input.condicionIva,
  };
  if (iva.length > 0) detail.Iva = iva;
  return detail;
}

export function parseFECAESolicitar(result: FECAESolicitarResult): ParsedFECAE {
  const raw = result.FeDetResp?.FECAEDetResponse;
  const det = Array.isArray(raw) ? raw[0] : raw;
  if (!det) {
    return { aprobada: false, resultado: "R", cbteNro: 0, observaciones: [] };
  }
  const observaciones: Array<{ code: number; msg: string }> = [];
  if (det.Observaciones) {
    const obs = Array.isArray(det.Observaciones.Obs)
      ? det.Observaciones.Obs
      : [det.Observaciones.Obs];
    for (const item of obs) {
      if (item) observaciones.push({ code: item.Code, msg: item.Msg });
    }
  }
  const aprobada = det.Resultado === "A" && Boolean(det.CAE);
  return {
    aprobada,
    resultado: det.Resultado === "A" ? "A" : "R",
    cae: aprobada ? det.CAE : undefined,
    caeVencimiento: aprobada ? det.CAEFchVto : undefined,
    cbteNro: Number(det.CbteDesde),
    observaciones,
  };
}

export function cbteTipoLabel(cbteTipo: number): string {
  switch (cbteTipo) {
    case CbteTipo.FACTURA_A:
      return "Factura A";
    case CbteTipo.NOTA_DEBITO_A:
      return "Nota de Débito A";
    case CbteTipo.NOTA_CREDITO_A:
      return "Nota de Crédito A";
    case CbteTipo.FACTURA_B:
      return "Factura B";
    case CbteTipo.NOTA_DEBITO_B:
      return "Nota de Débito B";
    case CbteTipo.NOTA_CREDITO_B:
      return "Nota de Crédito B";
    case CbteTipo.FACTURA_C:
      return "Factura C";
    default:
      return `Comprobante ${cbteTipo}`;
  }
}

export function formatComprobanteNumero(
  puntoVenta: number,
  cbteTipo: number,
  cbteNro: number,
): string {
  const pv = String(puntoVenta).padStart(4, "0");
  const nro = String(cbteNro).padStart(8, "0");
  const tipo = cbteTipoLabel(cbteTipo).replace(/\s+/g, "");
  return `${tipo}-${pv}-${nro}`;
}

export function buildQrUrl(
  _arca: unknown,
  params: {
    fecha: string;
    cuit: number;
    ptoVta: number;
    cbteTipo: number;
    cbteNro: number;
    total: number;
    docTipo: number;
    docNro: number;
    cae: string;
  },
): string {
  return Arca.generateQRUrl({
    fecha: params.fecha,
    cuit: params.cuit,
    ptoVta: params.ptoVta,
    tipoCmp: params.cbteTipo,
    nroCmp: params.cbteNro,
    importe: params.total,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: params.docTipo,
    nroDocRec: params.docNro,
    codAut: Number(params.cae),
  });
}

export { CbteTipo, DocTipo };
