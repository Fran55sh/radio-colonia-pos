import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setClockForTests } from "../../lib/fecha-ar.js";
import { setArcaConfigForTests } from "../../config/arca.js";
import { pool } from "../../config/db.js";
import { setArcaClientForTests } from "./arca-client.js";
import { barridoConciliacion } from "./conciliacion.js";
import { FakeArca } from "./fake-arca.js";
import { reintentarComprobante, setPersistFailuresForTests } from "./service.js";
import { applyPosSchema, closePool } from "../../../test/apply-pos-schema.js";
import { processSale } from "../pos/service.js";

const enabled = Boolean(process.env.TEST_DATABASE_URL);

async function resetRows(): Promise<void> {
  await pool.query(`
    TRUNCATE
      pos_comprobantes_fiscales_intentos,
      pos_iva_registro,
      pos_lineas_venta,
      pos_comprobantes_fiscales,
      pos_caja_movimientos,
      pos_ventas,
      product_variants,
      products
    RESTART IDENTITY CASCADE
  `);
}

async function seedSku(sku: string, price: number, alicuota = 21, stock = 20): Promise<void> {
  const product = await pool.query<{ id: string }>(
    `INSERT INTO products (slug, name, price, is_active) VALUES ($1, $2, $3, TRUE) RETURNING id`,
    [`p-${sku}-${randomUUID().slice(0, 6)}`, sku, price],
  );
  await pool.query(
    `INSERT INTO product_variants (product_id, sku, stock, sale_price, iva_alicuota, attributes)
     VALUES ($1, $2, $3, $4, $5, '{}')`,
    [product.rows[0].id, sku, stock, price, alicuota],
  );
}

describe.skipIf(!enabled)("recuperación fiscal", () => {
  const fake = new FakeArca();
  let cajaId = 0;

  beforeAll(async () => {
    await applyPosSchema();
    await applyPosSchema();
    const caja = await pool.query<{ id: number }>(
      `INSERT INTO pos_caja_sesiones (puesto, estado) VALUES ('Caja fiscal', 'abierta')
       ON CONFLICT DO NOTHING RETURNING id`,
    );
    if (caja.rows[0]) cajaId = caja.rows[0].id;
    else {
      const existing = await pool.query<{ id: number }>(
        `SELECT id FROM pos_caja_sesiones WHERE puesto = 'Caja fiscal' AND estado = 'abierta'`,
      );
      cajaId = existing.rows[0].id;
    }
    setArcaConfigForTests({
      enabled: true,
      cuit: 20111111112,
      ptoVta: 1,
      production: false,
      cert: "TEST",
      key: "TEST",
      ambiente: "dev",
    });
  });

  beforeEach(async () => {
    await resetRows();
    fake.reset();
    setPersistFailuresForTests(0);
    setArcaClientForTests(fake);
    pool.options.max = 20;
    pool.options.connectionTimeoutMillis = 5_000;
  });

  afterAll(async () => {
    setArcaClientForTests(null);
    setPersistFailuresForTests(0);
    await closePool();
  });

  async function vender(id: string, sku: string) {
    return processSale({
      client_sale_id: id,
      medio_pago: "Efectivo",
      lineas: [{ codigo_interno: sku, cantidad: 1 }],
      caja_sesion_id: cajaId,
    });
  }

  it("respuesta perdida se concilia con el mismo número y una autorización", async () => {
    await seedSku("sku-lost", 100);
    fake.pushFailure({ kind: "timeout_after_auth" });
    const first = await vender("sale-lost", "sku-lost");
    expect(first.fiscal?.estado).toBe("desconocido");
    expect(fake.authorizations).toBe(1);
    const again = await reintentarComprobante(first.venta_id);
    expect(again?.estado).toBe("emitido");
    expect(again?.cae).toBeTruthy();
    expect(fake.crearFacturaCalls).toBe(1);
    expect(fake.authorizations).toBe(1);
    const row = await pool.query<{ estado: string; cbte_nro: number }>(
      `SELECT estado, cbte_nro FROM pos_comprobantes_fiscales WHERE venta_id = $1`,
      [first.venta_id],
    );
    expect(row.rows[0].estado).toBe("emitido");
    expect(row.rows[0].cbte_nro).toBe(1);
  });

  it("caída antes de autorizar reemite el mismo número", async () => {
    await seedSku("sku-miss", 100);
    fake.pushFailure({ kind: "timeout_before_auth" });
    const first = await vender("sale-miss", "sku-miss");
    expect(first.fiscal?.estado).toBe("desconocido");
    const again = await reintentarComprobante(first.venta_id);
    expect(again?.estado).toBe("emitido");
    expect(again?.cbte_nro).toBe(1);
    expect(fake.authorizations).toBe(1);
  });

  it("si la persistencia falla después del CAE el barrido la recupera", async () => {
    await seedSku("sku-persist", 100);
    setPersistFailuresForTests(5);
    const first = await vender("sale-persist", "sku-persist");
    expect(first.fiscal?.estado).not.toBe("error");
    expect(first.fiscal?.cae ?? null).toBeNull();
    const mid = await pool.query<{ estado: string; cae: string | null }>(
      `SELECT estado, cae FROM pos_comprobantes_fiscales WHERE venta_id = $1`,
      [first.venta_id],
    );
    expect(mid.rows[0].cae).toBeNull();
    expect(mid.rows[0].estado).toBe("enviando");
    expect(fake.authorizations).toBe(1);
    setPersistFailuresForTests(0);
    await barridoConciliacion({ minAgeMs: 0 });
    const row = await pool.query<{ estado: string; cae: string; cbte_nro: number }>(
      `SELECT estado, cae, cbte_nro FROM pos_comprobantes_fiscales WHERE venta_id = $1`,
      [first.venta_id],
    );
    expect(row.rows[0].estado).toBe("emitido");
    expect(row.rows[0].cae).toBeTruthy();
    expect(row.rows[0].cbte_nro).toBe(1);
    expect(fake.authorizations).toBe(1);
  });

  it("cinco ventas concurrentes del mismo PV obtienen números consecutivos", async () => {
    await seedSku("sku-conc", 100, 21, 10);
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => vender(`sale-conc-${n}`, "sku-conc")),
    );
    expect(results.every((result) => result.fiscal?.estado === "emitido")).toBe(true);
    const numbers = results.map((result) => result.fiscal?.cbte_nro).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
    const ventas = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM pos_ventas`);
    expect(ventas.rows[0].n).toBe(5);
  });

  it("dos reintentos simultáneos autorizan una sola vez", async () => {
    await seedSku("sku-retry", 100);
    const sale = await processSale(
      {
        client_sale_id: "sale-retry",
        medio_pago: "Efectivo",
        lineas: [{ codigo_interno: "sku-retry", cantidad: 1 }],
        caja_sesion_id: cajaId,
      },
      { skipFiscal: true },
    );
    const [a, b] = await Promise.all([
      reintentarComprobante(sale.venta_id),
      reintentarComprobante(sale.venta_id),
    ]);
    expect(fake.crearFacturaCalls).toBe(1);
    expect(a?.cae).toBeTruthy();
    expect(b?.cae).toBe(a?.cae);
  });

  it("una venta mixta deja dos filas en el libro IVA", async () => {
    await seedSku("sku-21", 100, 21);
    await seedSku("sku-105", 100, 10.5);
    const result = await processSale({
      client_sale_id: "sale-mix",
      medio_pago: "Efectivo",
      lineas: [
        { codigo_interno: "sku-21", cantidad: 1 },
        { codigo_interno: "sku-105", cantidad: 1 },
      ],
      caja_sesion_id: cajaId,
    });
    expect(result.total).toBe(200);
    const libro = await pool.query<{ alicuota: string; neto: string; iva: string; total: string }>(
      `SELECT alicuota::float AS alicuota, neto_gravado::float AS neto, iva::float AS iva, total::float AS total
       FROM pos_iva_registro ORDER BY alicuota`,
    );
    expect(libro.rows).toEqual([
      { alicuota: 10.5, neto: 90.5, iva: 9.5, total: 100 },
      { alicuota: 21, neto: 82.64, iva: 17.36, total: 100 },
    ]);
  });

  it("a las 23:30 AR el libro, el comprobante y el QR usan el mismo día", async () => {
    setClockForTests(() => new Date("2026-10-18T02:30:00.000Z"));
    try {
      await seedSku("sku-noche", 100);
      const result = await vender("sale-noche", "sku-noche");
      const libro = await pool.query<{ fecha: string }>(
        `SELECT fecha_fiscal::text AS fecha FROM pos_iva_registro`,
      );
      const cbte = await pool.query<{ fecha: string }>(
        `SELECT fecha_cbte::text AS fecha FROM pos_comprobantes_fiscales`,
      );
      expect(libro.rows[0].fecha.startsWith("2026-10-17")).toBe(true);
      expect(cbte.rows[0].fecha.startsWith("2026-10-17")).toBe(true);
      const qr = JSON.parse(
        Buffer.from(result.fiscal!.qr_url!.split("p=")[1], "base64").toString("utf8"),
      ) as { fecha: string };
      expect(qr.fecha).toBe("2026-10-17");
      expect([...fake.book.values()][0]?.cbteFch).toBe("20261017");
    } finally {
      setClockForTests(null);
    }
  });

  it("un pool de 3 conexiones no se cuelga con 10 emisiones lentas", async () => {
    await seedSku("sku-pool", 100, 21, 20);
    const prevMax = pool.options.max;
    const prevTimeout = pool.options.connectionTimeoutMillis;
    pool.options.max = 3;
    pool.options.connectionTimeoutMillis = 400;
    fake.setStickyFailure({ kind: "slow", ms: 1200 });
    try {
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, index) => vender(`sale-pool-${index}`, "sku-pool")),
      );
      expect(results).toHaveLength(10);
      const ventas = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM pos_ventas`);
      expect(ventas.rows[0].n).toBe(10);
      const errores = results.filter((result) => result.fiscal?.estado === "error");
      expect(errores.length).toBeGreaterThan(0);
      expect(errores.every((result) => !result.fiscal?.cae)).toBe(true);
    } finally {
      pool.options.max = prevMax ?? 20;
      pool.options.connectionTimeoutMillis = prevTimeout ?? 5_000;
      fake.setStickyFailure(null);
    }
  });
});
