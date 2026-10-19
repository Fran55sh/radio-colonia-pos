import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setArcaConfigForTests } from "../../config/arca.js";
import { pool } from "../../config/db.js";
import { marcarComprobanteError } from "../fiscal/repository.js";
import { setArcaClientForTests } from "../fiscal/arca-client.js";
import { FakeArca } from "../fiscal/fake-arca.js";
import { processOfflineBatch, processSale, setPostCommitFaultForTests } from "./service.js";
import { applyPosSchema, closePool } from "../../../test/apply-pos-schema.js";

const enabled = Boolean(process.env.TEST_DATABASE_URL);

async function resetRows(): Promise<void> {
  await pool.query(`
    TRUNCATE
      pos_iva_registro,
      pos_lineas_venta,
      pos_comprobantes_fiscales,
      pos_caja_movimientos,
      pos_ventas,
      pos_clientes,
      product_variant_price_tiers,
      product_price_tiers,
      product_supplier_offers,
      product_variants,
      products
    RESTART IDENTITY CASCADE
  `);
}

async function seedSku(sku: string, price: number, stock = 5): Promise<void> {
  const product = await pool.query<{ id: string }>(
    `INSERT INTO products (slug, name, price, is_active)
     VALUES ($1, $2, $3, TRUE) RETURNING id`,
    [`p-${sku}-${randomUUID().slice(0, 8)}`, sku, price],
  );
  await pool.query(
    `INSERT INTO product_variants (product_id, sku, stock, sale_price, iva_alicuota, attributes)
     VALUES ($1, $2, $3, $4, 21, '{}')`,
    [product.rows[0].id, sku, stock, price],
  );
}

async function openCaja(): Promise<number> {
  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM pos_caja_sesiones WHERE estado = 'abierta' AND puesto = 'Caja test' LIMIT 1`,
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const created = await pool.query<{ id: number }>(
    `INSERT INTO pos_caja_sesiones (puesto, estado) VALUES ('Caja test', 'abierta') RETURNING id`,
  );
  return created.rows[0].id;
}

describe.skipIf(!enabled)("guardas fiscales de la venta", () => {
  const fake = new FakeArca();
  let cajaId = 0;

  beforeAll(async () => {
    await applyPosSchema();
    cajaId = await openCaja();
    setArcaConfigForTests({
      enabled: true,
      cuit: 20111111112,
      ptoVta: 1,
      production: false,
      cert: "TEST",
      key: "TEST",
      ambiente: "dev",
    });
    setArcaClientForTests(fake);
  });

  beforeEach(async () => {
    await resetRows();
    fake.reset();
    setPostCommitFaultForTests(null);
    setArcaClientForTests(fake);
  });

  afterAll(async () => {
    setArcaClientForTests(null);
    setPostCommitFaultForTests(null);
    await closePool();
  });

  it("rechaza una venta de $0 antes de registrar", async () => {
    await seedSku("sku-cero", 0, 4);
    await expect(
      processSale({
        client_sale_id: "sale-cero",
        medio_pago: "Efectivo",
        lineas: [{ codigo_interno: "sku-cero", cantidad: 1 }],
        caja_sesion_id: cajaId,
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: "VENTA_SIN_IMPORTES" });

    const ventas = await pool.query(`SELECT id FROM pos_ventas`);
    const stock = await pool.query<{ stock: number }>(
      `SELECT stock FROM product_variants WHERE sku = 'sku-cero'`,
    );
    expect(ventas.rowCount).toBe(0);
    expect(stock.rows[0].stock).toBe(4);
  });

  it("un 40P01 despues del commit no duplica la venta", async () => {
    await seedSku("sku-dead", 100, 3);
    setPostCommitFaultForTests(() => {
      const err = new Error("deadlock") as Error & { code: string };
      err.code = "40P01";
      throw err;
    });
    const result = await processSale({
      client_sale_id: "sale-dead",
      medio_pago: "Efectivo",
      lineas: [{ codigo_interno: "sku-dead", cantidad: 1 }],
      caja_sesion_id: cajaId,
    });
    expect(result.fiscal?.estado).toBe("error");
    expect(result.fiscal?.cae).toBeNull();
    const ventas = await pool.query(`SELECT id FROM pos_ventas`);
    const stock = await pool.query<{ stock: number }>(
      `SELECT stock FROM product_variants WHERE sku = 'sku-dead'`,
    );
    expect(ventas.rowCount).toBe(1);
    expect(stock.rows[0].stock).toBe(2);
  });

  it("marcarComprobanteError no pisa una fila con CAE", async () => {
    const venta = await pool.query<{ id: number }>(
      `INSERT INTO pos_ventas (medio_pago, total) VALUES ('Efectivo', 100) RETURNING id`,
    );
    await pool.query(
      `INSERT INTO pos_comprobantes_fiscales (
         venta_id, estado, ambiente, emisor_cuit, punto_venta, cbte_tipo, cbte_nro, cae
       ) VALUES ($1, 'emitido', 'dev', '20111111112', 1, 6, 9, '12345678901234')`,
      [venta.rows[0].id],
    );
    await marcarComprobanteError(venta.rows[0].id, "ARCA_ERROR", "no deberia pisar", { x: 1 });
    const row = await pool.query<{ estado: string; cae: string }>(
      `SELECT estado, cae FROM pos_comprobantes_fiscales WHERE venta_id = $1`,
      [venta.rows[0].id],
    );
    expect(row.rows[0]).toEqual({ estado: "emitido", cae: "12345678901234" });
  });

  it("el replay no vuelve a emitir si ya hay comprobante", async () => {
    await seedSku("sku-replay", 100, 3);
    const first = await processSale(
      {
        client_sale_id: "sale-replay",
        medio_pago: "Efectivo",
        lineas: [{ codigo_interno: "sku-replay", cantidad: 1 }],
        caja_sesion_id: cajaId,
      },
      { skipFiscal: true },
    );
    await pool.query(
      `INSERT INTO pos_comprobantes_fiscales (
         venta_id, estado, ambiente, emisor_cuit, punto_venta, cbte_tipo, cbte_nro, cae
       ) VALUES ($1, 'emitido', 'dev', '20111111112', 1, 6, 3, '999')`,
      [first.venta_id],
    );
    fake.reset();
    const replay = await processSale({
      client_sale_id: "sale-replay",
      medio_pago: "Efectivo",
      lineas: [{ codigo_interno: "sku-replay", cantidad: 1 }],
      caja_sesion_id: cajaId,
    });
    expect(replay.duplicada).toBe(true);
    expect(replay.venta_id).toBe(first.venta_id);
    expect(fake.facturarCalls).toBe(0);
    expect(fake.crearFacturaCalls).toBe(0);
    const ventas = await pool.query(`SELECT id FROM pos_ventas`);
    expect(ventas.rowCount).toBe(1);
  });

  it("un segundo POST con el mismo client_sale_id no duplica venta, caja ni stock", async () => {
    await seedSku("sku-doble", 100, 5);
    const payload = {
      client_sale_id: "sale-doble",
      medio_pago: "Efectivo",
      lineas: [{ codigo_interno: "sku-doble", cantidad: 1 }],
      caja_sesion_id: cajaId,
    };
    const first = await processSale(payload, { skipFiscal: true });
    const second = await processSale(payload, { skipFiscal: true });
    expect(first.duplicada).toBeUndefined();
    expect(second.duplicada).toBe(true);
    expect(second.venta_id).toBe(first.venta_id);

    const ventas = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM pos_ventas`);
    const movs = await pool.query<{ n: number; total: string }>(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::text AS total
       FROM pos_caja_movimientos WHERE estado = 'activo'`,
    );
    const stock = await pool.query<{ stock: number }>(
      `SELECT stock FROM product_variants WHERE sku = 'sku-doble'`,
    );
    expect(ventas.rows[0].n).toBe(1);
    expect(movs.rows[0].n).toBe(1);
    expect(Number(movs.rows[0].total)).toBe(100);
    expect(stock.rows[0].stock).toBe(4);
  });

  it("el lote offline cuenta duplicadas por el flag", async () => {
    await seedSku("sku-off", 100, 5);
    const venta = {
      client_sale_id: "sale-off",
      medio_pago: "Efectivo",
      lineas: [{ codigo_interno: "sku-off", cantidad: 1 }],
      caja_sesion_id: cajaId,
      sincronizada_offline: true as const,
    };
    const result = await processOfflineBatch([venta, venta]);
    expect(result.procesadas).toBe(1);
    expect(result.duplicadas).toBe(1);
    expect(result.errores).toHaveLength(0);
    const ventas = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM pos_ventas`);
    const stock = await pool.query<{ stock: number }>(
      `SELECT stock FROM product_variants WHERE sku = 'sku-off'`,
    );
    expect(ventas.rows[0].n).toBe(1);
    expect(stock.rows[0].stock).toBe(4);
  });

  it("$100 @21% envía 82,64 / 17,36 / 100 y el QR usa 100", async () => {
    await seedSku("sku-100", 100, 5);
    const result = await processSale({
      client_sale_id: "sale-100",
      medio_pago: "Efectivo",
      lineas: [{ codigo_interno: "sku-100", cantidad: 1 }],
      caja_sesion_id: cajaId,
    });
    expect(result.total).toBe(100);
    expect(result.fiscal?.estado).toBe("emitido");
    const line = await pool.query<{ neto_linea: string; iva_linea: string; total_linea: string }>(
      `SELECT neto_linea::text, iva_linea::text, total_linea::text FROM pos_lineas_venta`,
    );
    expect(line.rows[0]).toEqual({ neto_linea: "82.64", iva_linea: "17.36", total_linea: "100.00" });
    const book = [...fake.book.values()];
    expect(book).toHaveLength(1);
    expect(book[0]).toMatchObject({ impTotal: 100, impNeto: 82.64, impIva: 17.36 });
    const qr = JSON.parse(
      Buffer.from(result.fiscal!.qr_url!.split("p=")[1], "base64").toString("utf8"),
    ) as { importe: number };
    expect(qr.importe).toBe(100);
    const mov = await pool.query<{ amount: string }>(
      `SELECT amount::text FROM pos_caja_movimientos WHERE estado = 'activo'`,
    );
    expect(mov.rows[0].amount).toBe("100.00");
  });
});
