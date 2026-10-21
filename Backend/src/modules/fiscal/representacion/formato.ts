const moneyFmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const tasaFmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const cotizFmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 6,
});

export function formatImporte(value: number): string {
  return moneyFmt.format(roundMoney(value));
}

export function formatTasa(value: number): string {
  return tasaFmt.format(value);
}

export function formatCotizacion(value: number): string {
  return cotizFmt.format(value);
}

export function formatCantidad(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(value);
}

/** Unitario de presentación a partir del importe de línea ya persistido. */
export function formatUnitario(importe: number, cantidad: number): string {
  if (!Number.isFinite(cantidad) || cantidad === 0) return formatImporte(importe);
  const cents = Math.round(roundMoney(importe) * 100);
  if (Number.isInteger(cantidad) && cantidad > 0 && cents % cantidad === 0) {
    return formatImporte(cents / cantidad / 100);
  }
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(importe / cantidad);
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatFechaIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!match) return iso.trim();
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function fechaPdfEstable(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return new Date(Date.UTC(2020, 0, 1, 12, 0, 0));
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
}

export function formatCuit(digits: string): string {
  const clean = digits.replace(/\D/g, "");
  if (clean.length !== 11) return clean || digits;
  return `${clean.slice(0, 2)}-${clean.slice(2, 10)}-${clean.slice(10)}`;
}

export function padPv(puntoVenta: number): string {
  return String(puntoVenta).padStart(4, "0");
}

export function padNro(cbteNro: number): string {
  return String(cbteNro).padStart(8, "0");
}

export function nombreArchivoFactura(prefijo: string, letra: string, puntoVenta: number, cbteNro: number): string {
  return `${prefijo}-${letra}-${padPv(puntoVenta)}-${padNro(cbteNro)}.pdf`;
}

export function numeroVisual(puntoVenta: number, cbteNro: number): string {
  return `${padPv(puntoVenta)}-${padNro(cbteNro)}`;
}
