export type EmisorPresentacion = {
  razonSocial: string | null;
  domicilio: string | null;
  condicionIva: string | null;
  ingresosBrutos: string | null;
  inicioActividades: string | null;
};

function blank(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Datos de membrete que no viajan en el comprobante (no están en WSFE).
 * La condición default es la del emisor de este POS: Responsable Inscripto.
 * No emite Factura C; el render igual sabe representarla si existiera un CAE.
 */
export function leerEmisorPresentacion(source: NodeJS.ProcessEnv = process.env): EmisorPresentacion {
  return {
    razonSocial: blank(source.FISCAL_EMISOR_RAZON_SOCIAL),
    domicilio: blank(source.FISCAL_EMISOR_DOMICILIO),
    condicionIva: blank(source.FISCAL_EMISOR_CONDICION_IVA) ?? "IVA Responsable Inscripto",
    ingresosBrutos: blank(source.FISCAL_EMISOR_INGRESOS_BRUTOS),
    inicioActividades: blank(source.FISCAL_EMISOR_INICIO_ACTIVIDADES),
  };
}
