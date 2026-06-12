export type FiscalEstado = "pendiente" | "emitido" | "error" | "anulado";

export type ClienteFiscal = {
  id: number;
  nombre: string;
  documento: string | null;
  documento_tipo_afip: string | null;
  condicion_iva_receptor_id: number | null;
  razon_social: string | null;
};

export type LineaFiscal = {
  neto_linea: number;
  iva_linea: number;
  exento_linea: number;
  alicuota_iva: number;
};

export type VentaFiscalContext = {
  venta_id: number;
  cliente_id: number | null;
  neto_gravado: number;
  iva_total: number;
  exento: number;
  total: number;
  lineas: LineaFiscal[];
  cliente: ClienteFiscal | null;
};

export type ComprobanteFiscalResponse = {
  estado: FiscalEstado;
  comprobante: string | null;
  cbte_tipo: number;
  cbte_tipo_label: string;
  cbte_nro: number | null;
  punto_venta: number;
  cae: string | null;
  cae_vencimiento: string | null;
  qr_url: string | null;
  error_message: string | null;
  ambiente: string;
};
