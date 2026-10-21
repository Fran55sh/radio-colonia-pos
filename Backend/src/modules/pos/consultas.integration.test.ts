import Fastify from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../config/db.js";
import { applyPosSchema, closePool } from "../../../test/apply-pos-schema.js";
import { listarVentas } from "./consultas.js";
import { posRoutes } from "./routes.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)("historial paginado", () => {
  beforeAll(applyPosSchema);
  beforeEach(async () => {
    await pool.query("TRUNCATE pos_ventas RESTART IDENTITY CASCADE");
  });
  afterAll(closePool);

  it("recupera más de 100 ventas sin repetir ni omitir al insertar una venta entre páginas", async () => {
    // Fechas con microsegundos y empates: el cursor conserva la precisión de Postgres.
    await pool.query(`INSERT INTO pos_ventas (medio_pago, total, created_at)
      SELECT 'Efectivo', n, '2026-10-19 10:00:00.123456+00'::timestamptz
        + ((n / 3)::text || ' seconds')::interval FROM generate_series(1, 125) AS n`);
    const expected = await pool.query<{ id: number }>(
      "SELECT id FROM pos_ventas ORDER BY created_at DESC, id DESC",
    );
    let page = await listarVentas(40);
    const ids = page.ventas.map((v) => v.id);
    expect(page.next_cursor).not.toBeNull();
    await pool.query("INSERT INTO pos_ventas (medio_pago, total) VALUES ('Efectivo', 999)");
    while (page.next_cursor != null) {
      page = await listarVentas(40, page.next_cursor);
      ids.push(...page.ventas.map((v) => v.id));
      expect(ids.length).toBeLessThanOrEqual(125);
    }
    expect(ids).toEqual(expected.rows.map((v) => v.id));
    expect(new Set(ids).size).toBe(125);
    expect(page.ventas).toHaveLength(5);
    expect((await listarVentas(40)).ventas[0].total).toBe(999);
  });

  it("no ofrece otra página cuando las únicas ventas restantes están anuladas", async () => {
    await pool.query(`INSERT INTO pos_ventas (medio_pago, estado)
      VALUES ('Efectivo', 'anulada'), ('Efectivo', 'completada'), ('Efectivo', 'completada')`);
    const page = await listarVentas(2);
    expect(page.ventas).toHaveLength(2);
    expect(page.next_cursor).toBeNull();
  });

  it("expone el cursor por HTTP y rechaza cursores inválidos", async () => {
    await pool.query("INSERT INTO pos_ventas (medio_pago) SELECT 'Efectivo' FROM generate_series(1, 3)");
    const app = Fastify();
    await app.register(posRoutes);
    try {
      const first = await app.inject({ url: "/ventas?limit=2" });
      expect(first.statusCode).toBe(200);
      const body = first.json();
      const second = await app.inject({ url: `/ventas?limit=2&before=${body.next_cursor}` });
      expect(second.json().ventas).toHaveLength(1);
      expect(second.json().next_cursor).toBeNull();
      for (const cursor of ["0", "-1", "NaN", "1.5", "2147483648"]) {
        expect((await app.inject({ url: `/ventas?before=${cursor}` })).statusCode).toBe(400);
      }
    } finally {
      await app.close();
    }
  });
});
