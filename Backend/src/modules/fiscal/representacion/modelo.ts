import { IVA_RATES, type IvaTipo } from "@ramiidv/arca-facturacion";
import { AppError } from "../../../middleware/errors.js";
import { discriminaIva } from "../cbte-tipo.js";
import { labelCondicionIva } from "../iva-condiciones.js";
import { buildQrUrl } from "../mappers.js";
import { assertFacturaAutorizada } from "./autorizado.js";
import type { EmisorPresentacion } from "./emisor.js";
import {
  fechaPdfEstable,
  formatCantidad,
  formatCotizacion,
  formatCuit,
  formatFechaIso,
  formatImporte,
  formatTasa,
  formatUnitario,
  nombreArchivoFactura,
  numeroVisual,
} from "./formato.js";

export type IvaPersistido = {
  id: number;
  base: number;
  importe: number;
};

export type LineaPersistida = {
  codigo: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  alicuota: number;
  neto: number;
  iva: number;
  exento: number;
  total: number;
};

export type ReceptorPersistido = {
  nombre: string | null;
  razonSocial: string | null;
  domicilio: string | null;
  email: string | null;
  telefono: string | null;
};

/** Snapshot fiscal ya guardado. El armado no recalcula impuestos. */
export type FacturaPersistida = {
  ventaId: number;
  estado: string;
  ambiente: string;
  emisorCuit: string;
  puntoVenta: number;
  cbteTipo: number;
  cbteNro: number | null;
  fechaCbte: string | null;
  cae: string | null;
  caeVencimiento: string | null;
  qrUrl: string | null;
  docTipo: number | null;
  docNro: number | null;
  condicionIvaReceptorId: number | null;
  netoGravado: number;
  ivaTotal: number;
  exento: number;
  total: number;
  impTotalEnviado: number | null;
  ivaDetalle: IvaPersistido[];
  moneda: string | null;
  cotizacion: number | null;
  impTrib: number | null;
  concepto: number | null;
  medioPago: string | null;
  receptor: ReceptorPersistido | null;
  lineas: LineaPersistida[];
};

export type FilaFactura = {
  codigo: string;
  descripcion: string;
  cantidad: string;
  unidad: string;
  alicuota: string | null;
  precioUnitario: string;
  bonificacion: string;
  importe: string;
};

export type ImporteEtiquetado = {
  etiqueta: string;
  importe: string;
};

export type FacturaRepresentacion = {
  archivo: string;
  titulo: string;
  letra: "A" | "B" | "C";
  codigo: string;
  numeroVisual: string;
  puntoVentaTexto: string;
  cbteNroTexto: string;
  fechaEmision: string;
  fechaPdf: Date;
  cae: string;
  caeVencimiento: string;
  qrUrl: string;
  ambiente: string;
  moneda: string;
  cotizacion: string;
  concepto: string | null;
  condicionVenta: string;
  medioPago: string;
  discriminaIva: boolean;
  /** El POS no guarda unidad de medida ni un descuento aparte del precio cobrado. */
  unidadPresentacion: "unidades";
  bonificacionPresentacion: "—";
  emisor: {
    razonSocial: string;
    domicilio: string;
    condicionIva: string;
    cuit: string;
    ingresosBrutos: string;
    inicioActividades: string;
  };
  receptor: {
    nombre: string;
    domicilio: string;
    condicionIva: string;
    documento: string;
    leyendaConsumidorFinal: boolean;
  };
  lineas: FilaFactura[];
  transparencia: {
    iva: ImporteEtiquetado[];
    otrosImpuestos: string;
  } | null;
  totales: {
    netoGravado: string | null;
    iva: ImporteEtiquetado[];
    exento: string | null;
    otrosTributos: string | null;
    total: string;
  };
};

const COMPROBANTES: Record<number, { letra: "A" | "B" | "C"; titulo: string; archivo: string }> = {
  1: { letra: "A", titulo: "FACTURA", archivo: "Factura" },
  2: { letra: "A", titulo: "NOTA DE DÉBITO", archivo: "NotaDebito" },
  3: { letra: "A", titulo: "NOTA DE CRÉDITO", archivo: "NotaCredito" },
  6: { letra: "B", titulo: "FACTURA", archivo: "Factura" },
  7: { letra: "B", titulo: "NOTA DE DÉBITO", archivo: "NotaDebito" },
  8: { letra: "B", titulo: "NOTA DE CRÉDITO", archivo: "NotaCredito" },
  11: { letra: "C", titulo: "FACTURA", archivo: "Factura" },
  12: { letra: "C", titulo: "NOTA DE DÉBITO", archivo: "NotaDebito" },
  13: { letra: "C", titulo: "NOTA DE CRÉDITO", archivo: "NotaCredito" },
};

const DOC_LABEL: Record<number, string> = {
  0: "Sin identificar",
  80: "CUIT",
  86: "CUIL",
  87: "CDI",
  89: "LE",
  90: "LC",
  91: "CI extranjera",
  94: "Pasaporte",
  96: "DNI",
  99: "Consumidor final",
};

const CONDICIONES_TRANSPARENCIA = new Set([3, 4, 5, 7, 15]);

function noInformado(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "No informado";
}

function tasaDeId(id: number): string | null {
  const rate = IVA_RATES[id as IvaTipo];
  if (rate == null || Number.isNaN(rate)) return null;
  return formatTasa(rate);
}

function etiquetaConcepto(concepto: number | null): string | null {
  if (concepto == null) return null;
  if (concepto === 1) return "Productos";
  if (concepto === 2) return "Servicios";
  if (concepto === 3) return "Productos y servicios";
  return `Concepto ${concepto}`;
}

function documentoReceptor(docTipo: number, docNro: number): string {
  const label = DOC_LABEL[docTipo] ?? `Tipo ${docTipo}`;
  if (docTipo === 99 || docNro === 0) {
    return `${label} — doc. tipo ${docTipo}, nro. ${docNro}`;
  }
  if (docTipo === 80 || docTipo === 86) {
    return `${label} ${formatCuit(String(docNro).padStart(11, "0"))}`;
  }
  return `${label} ${docNro}`;
}

function qrDesdePersistido(data: FacturaPersistida, cbteNro: number, fecha: string, cae: string): string {
  if (data.qrUrl?.trim()) return data.qrUrl.trim();
  const cuit = data.emisorCuit.replace(/\D/g, "");
  if (cuit.length !== 11 || data.docTipo == null || data.docNro == null) {
    throw new AppError(
      409,
      "DATOS_FISCALES_INCOMPLETOS",
      "La factura autorizada no tiene QR ni los datos persistidos para reconstruirlo",
    );
  }
  const importe = data.impTotalEnviado ?? data.total;
  return buildQrUrl(null, {
    fecha,
    cuit: Number(cuit),
    ptoVta: data.puntoVenta,
    cbteTipo: data.cbteTipo,
    cbteNro,
    total: importe,
    docTipo: data.docTipo,
    docNro: data.docNro,
    cae,
  });
}

function fila(data: FacturaPersistida, linea: LineaPersistida, letra: "A" | "B" | "C"): FilaFactura {
  const discrimina = letra === "A";
  const importeFuente = discrimina
    ? linea.alicuota <= 0
      ? linea.exento
      : linea.neto
    : linea.total;
  return {
    codigo: linea.codigo,
    descripcion: linea.descripcion,
    cantidad: formatCantidad(linea.cantidad),
    unidad: "unidades",
    alicuota: discrimina ? (linea.alicuota <= 0 ? "Exento" : `${formatTasa(linea.alicuota)}%`) : null,
    precioUnitario: formatUnitario(importeFuente, linea.cantidad),
    bonificacion: "—",
    importe: formatImporte(importeFuente),
  };
}

/**
 * Arma la representación visual desde valores ya autorizados.
 * Factura C se puede representar; un emisor RI no la emite (ver resolverComprobante).
 */
export function armarRepresentacion(
  data: FacturaPersistida,
  emisor: EmisorPresentacion,
): FacturaRepresentacion {
  assertFacturaAutorizada(data.estado, data.cae);
  const meta = COMPROBANTES[data.cbteTipo];
  if (!meta) {
    throw new AppError(
      409,
      "DATOS_FISCALES_INCOMPLETOS",
      `Tipo de comprobante ${data.cbteTipo} sin representación`,
    );
  }
  if (data.cbteNro == null || data.fechaCbte == null || data.docTipo == null || data.docNro == null) {
    throw new AppError(
      409,
      "DATOS_FISCALES_INCOMPLETOS",
      "Faltan número, fecha o documento del receptor persistidos",
    );
  }

  const cae = data.cae!.trim();
  const fechaIso = data.fechaCbte.slice(0, 10);
  const qrUrl = qrDesdePersistido(data, data.cbteNro, fechaIso, cae);
  const total = data.impTotalEnviado ?? data.total;
  const discrimina = discriminaIva(data.cbteTipo) && meta.letra === "A";
  const consumidorFinal =
    data.docTipo === 99 ||
    data.condicionIvaReceptorId == null ||
    CONDICIONES_TRANSPARENCIA.has(data.condicionIvaReceptorId);
  const mostrarTransparencia = meta.letra !== "A" && (consumidorFinal || meta.letra === "B" || meta.letra === "C");

  const ivaLineas = data.ivaDetalle.map((row) => {
    const tasa = tasaDeId(row.id);
    return {
      etiqueta: tasa ? `IVA ${tasa}%` : "IVA",
      importe: formatImporte(row.importe),
    };
  });

  const transparenciaIva =
    data.ivaDetalle.length > 0
      ? data.ivaDetalle.map((row) => {
          const tasa = tasaDeId(row.id);
          return {
            etiqueta: tasa ? `IVA Contenido ${tasa}%` : "IVA Contenido",
            importe: formatImporte(row.importe),
          };
        })
      : [{ etiqueta: "IVA Contenido", importe: formatImporte(data.ivaTotal) }];

  const nombreReceptor =
    data.receptor?.razonSocial?.trim() ||
    data.receptor?.nombre?.trim() ||
    (data.docTipo === 99 ? "Consumidor Final" : "No informado");

  const moneda = data.moneda?.trim() || "PES";
  const cotizacion = data.cotizacion == null ? 1 : data.cotizacion;

  return {
    archivo: nombreArchivoFactura(meta.archivo, meta.letra, data.puntoVenta, data.cbteNro),
    titulo: meta.titulo,
    letra: meta.letra,
    codigo: String(data.cbteTipo).padStart(2, "0"),
    numeroVisual: numeroVisual(data.puntoVenta, data.cbteNro),
    puntoVentaTexto: String(data.puntoVenta).padStart(4, "0"),
    cbteNroTexto: String(data.cbteNro).padStart(8, "0"),
    fechaEmision: formatFechaIso(fechaIso) ?? fechaIso,
    fechaPdf: fechaPdfEstable(fechaIso),
    cae,
    caeVencimiento: formatFechaIso(data.caeVencimiento) ?? "No informado",
    qrUrl,
    ambiente: data.ambiente,
    moneda,
    cotizacion: formatCotizacion(cotizacion),
    concepto: etiquetaConcepto(data.concepto),
    condicionVenta: "Contado",
    medioPago: data.medioPago?.trim() || "No informado",
    discriminaIva: discrimina,
    unidadPresentacion: "unidades",
    bonificacionPresentacion: "—",
    emisor: {
      razonSocial: noInformado(emisor.razonSocial),
      domicilio: noInformado(emisor.domicilio),
      condicionIva: noInformado(emisor.condicionIva),
      cuit: formatCuit(data.emisorCuit),
      ingresosBrutos: noInformado(emisor.ingresosBrutos),
      inicioActividades: formatFechaIso(emisor.inicioActividades) ?? noInformado(emisor.inicioActividades),
    },
    receptor: {
      nombre: nombreReceptor,
      domicilio: noInformado(data.receptor?.domicilio),
      condicionIva: labelCondicionIva(data.condicionIvaReceptorId),
      documento: documentoReceptor(data.docTipo, data.docNro),
      leyendaConsumidorFinal: data.docTipo === 99 || data.condicionIvaReceptorId === 5,
    },
    lineas: data.lineas.map((linea) => fila(data, linea, meta.letra)),
    transparencia: mostrarTransparencia
      ? {
          iva: transparenciaIva,
          otrosImpuestos: data.impTrib == null ? "No informado" : formatImporte(data.impTrib),
        }
      : null,
    totales: {
      netoGravado: discrimina ? formatImporte(data.netoGravado) : null,
      iva: discrimina ? ivaLineas : [],
      exento: data.exento > 0 ? formatImporte(data.exento) : null,
      otrosTributos: discrimina && data.impTrib != null ? formatImporte(data.impTrib) : null,
      total: formatImporte(total),
    },
  };
}
