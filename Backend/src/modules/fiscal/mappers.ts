import { Arca, CbteTipo, DocTipo, IvaTipo } from "@ramiidv/arca-facturacion";
import { AppError } from "../../middleware/errors.js";
import type { LineaFiscal } from "./types.js";

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

export type ArcaFacturaItem = {
  neto: number;
  iva?: IvaTipo;
  exento?: boolean;
};

/** Agrupa líneas POS por alícuota para minimizar ítems enviados a ARCA. */
export function lineasToArcaItems(lineas: LineaFiscal[]): ArcaFacturaItem[] {
  const gravado = new Map<number, number>();
  let exentoTotal = 0;

  for (const l of lineas) {
    if (l.exento_linea > 0) {
      exentoTotal += l.exento_linea;
      continue;
    }
    if (l.neto_linea <= 0 && l.iva_linea <= 0) continue;
    const prev = gravado.get(l.alicuota_iva) ?? 0;
    gravado.set(l.alicuota_iva, prev + l.neto_linea);
  }

  const items: ArcaFacturaItem[] = [];
  for (const [alicuota, neto] of gravado) {
    if (neto > 0) {
      items.push({ neto, iva: mapAlicuotaToIvaTipo(alicuota) });
    }
  }
  if (exentoTotal > 0) {
    items.push({ neto: exentoTotal, exento: true });
  }
  if (items.length === 0) {
    throw new AppError(400, "VENTA_SIN_IMPORTES", "La venta no tiene importes facturables");
  }
  return items;
}

export function cbteTipoLabel(cbteTipo: number): string {
  switch (cbteTipo) {
    case CbteTipo.FACTURA_A:
      return "Factura A";
    case CbteTipo.FACTURA_B:
      return "Factura B";
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
  _arca: Arca,
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
