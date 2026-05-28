/** Precios POS incluyen IVA. Descompone total en neto + IVA por alícuota. */
export type IvaBreakdown = {
  netoGravado: number;
  iva: number;
  exento: number;
  total: number;
};

export function splitPriceWithIva(
  totalConIva: number,
  alicuota: number,
): IvaBreakdown {
  if (alicuota <= 0) {
    return { netoGravado: 0, iva: 0, exento: totalConIva, total: totalConIva };
  }
  const neto = Math.round(totalConIva / (1 + alicuota / 100));
  const iva = totalConIva - neto;
  return { netoGravado: neto, iva, exento: 0, total: totalConIva };
}

export function roundMoney(n: number): number {
  return Math.round(n);
}
