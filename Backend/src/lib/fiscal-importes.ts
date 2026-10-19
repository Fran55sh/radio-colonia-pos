/**
 * Contrato único de importes fiscales, todo en centavos.
 * neto_g = round(T_g / (1 + a)) e iva_g = T_g - neto_g, así neto + iva = total cobrado.
 * La fórmula (b) de D1 (ImpTotConc) no está activa: el gate de homologación no se pudo correr
 * en este entorno y solo se aplica si ARCA rechaza la diferencia de 1 centavo.
 */

export type LineaImporteInput = {
  orden: number;
  cantidad: number;
  precio_unitario: number;
  alicuota: number;
};

export type LineaImporte = {
  orden: number;
  alicuota: number;
  total_cents: number;
  neto_cents: number;
  iva_cents: number;
  exento_cents: number;
};

export type GrupoImporte = {
  alicuota: number;
  total_cents: number;
  neto_cents: number;
  iva_cents: number;
  exento_cents: number;
};

export type ImportesVenta = {
  lineas: LineaImporte[];
  grupos: GrupoImporte[];
  neto_cents: number;
  iva_cents: number;
  exento_cents: number;
  total_cents: number;
  imp_tot_conc_cents: number;
};

export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const pesos = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, "0");
  return `${sign}${pesos}.${dec}`;
}

export function moneyFromCents(cents: number): number {
  return Number(centsToDecimal(cents));
}

function basisPoints(alicuota: number): number {
  return Math.round(alicuota * 100);
}

function netoDeGrupo(totalCents: number, alicuota: number): number {
  const denom = 10_000 + basisPoints(alicuota);
  return Math.round((totalCents * 10_000) / denom);
}

function distribuirNeto(
  lineas: Array<{ orden: number; total_cents: number }>,
  netoGrupo: number,
  alicuota: number,
): Map<number, number> {
  const denom = 10_000 + basisPoints(alicuota);
  const parts = lineas.map((linea, index) => {
    const exact = (linea.total_cents * 10_000) / denom;
    const base = Math.floor(exact);
    return { orden: linea.orden, index, base, frac: exact - base };
  });
  let leftover = netoGrupo - parts.reduce((sum, part) => sum + part.base, 0);
  const byRemainder = [...parts].sort((a, b) => b.frac - a.frac || a.index - b.index);
  if (leftover > 0) {
    for (let i = 0; i < leftover; i++) byRemainder[i % byRemainder.length].base += 1;
  } else if (leftover < 0) {
    const asc = [...byRemainder].reverse();
    leftover = -leftover;
    for (let i = 0; i < leftover; i++) asc[i % asc.length].base -= 1;
  }
  return new Map(parts.map((part) => [part.orden, part.base]));
}

export function calcularImportesVenta(input: LineaImporteInput[]): ImportesVenta {
  const prepared = input.map((linea) => ({
    orden: linea.orden,
    alicuota: linea.alicuota,
    total_cents: Math.round(linea.precio_unitario * linea.cantidad * 100),
  }));

  const groupOrder: number[] = [];
  const buckets = new Map<number, Array<{ orden: number; total_cents: number }>>();
  for (const linea of prepared) {
    const key = linea.alicuota;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      groupOrder.push(key);
    }
    buckets.get(key)!.push({ orden: linea.orden, total_cents: linea.total_cents });
  }

  const netoPorOrden = new Map<number, number>();
  const grupos: GrupoImporte[] = [];

  for (const alicuota of groupOrder) {
    const rows = buckets.get(alicuota)!;
    const total = rows.reduce((sum, row) => sum + row.total_cents, 0);
    if (alicuota <= 0) {
      for (const row of rows) netoPorOrden.set(row.orden, 0);
      grupos.push({
        alicuota,
        total_cents: total,
        neto_cents: 0,
        iva_cents: 0,
        exento_cents: total,
      });
      continue;
    }
    const neto = netoDeGrupo(total, alicuota);
    const iva = total - neto;
    const assigned = distribuirNeto(rows, neto, alicuota);
    for (const [orden, netoLinea] of assigned) netoPorOrden.set(orden, netoLinea);
    grupos.push({
      alicuota,
      total_cents: total,
      neto_cents: neto,
      iva_cents: iva,
      exento_cents: 0,
    });
  }

  const lineas: LineaImporte[] = prepared
    .map((linea) => {
      const exento = linea.alicuota <= 0;
      const neto = exento ? 0 : (netoPorOrden.get(linea.orden) ?? 0);
      const iva = exento ? 0 : linea.total_cents - neto;
      return {
        orden: linea.orden,
        alicuota: linea.alicuota,
        total_cents: linea.total_cents,
        neto_cents: neto,
        iva_cents: iva,
        exento_cents: exento ? linea.total_cents : 0,
      };
    })
    .sort((a, b) => a.orden - b.orden);

  const neto_cents = grupos.reduce((sum, grupo) => sum + grupo.neto_cents, 0);
  const iva_cents = grupos.reduce((sum, grupo) => sum + grupo.iva_cents, 0);
  const exento_cents = grupos.reduce((sum, grupo) => sum + grupo.exento_cents, 0);
  const total_cents = grupos.reduce((sum, grupo) => sum + grupo.total_cents, 0);

  return {
    lineas,
    grupos,
    neto_cents,
    iva_cents,
    exento_cents,
    total_cents,
    imp_tot_conc_cents: 0,
  };
}

export function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}
