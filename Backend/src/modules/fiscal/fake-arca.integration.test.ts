import { afterAll, describe, expect, it } from "vitest";
import { applyPosSchema, closePool } from "../../../test/apply-pos-schema.js";
import { pool } from "../../config/db.js";
import { getArcaClient, setArcaClientForTests } from "./arca-client.js";
import { FakeArca } from "./fake-arca.js";

const enabled = Boolean(process.env.TEST_DATABASE_URL);

describe.skipIf(!enabled)("infra de integración fiscal", () => {
  const fake = new FakeArca();

  afterAll(async () => {
    setArcaClientForTests(null);
    await closePool();
  });

  it("aplica el fixture dos veces y el cliente falso autoriza, corta y rechaza", async () => {
    await applyPosSchema();
    await applyPosSchema();

    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [["pos_ventas", "pos_comprobantes_fiscales", "pos_iva_registro", "pos_lineas_venta"]],
    );
    expect(tables.rows.map((row) => row.table_name).sort()).toEqual([
      "pos_comprobantes_fiscales",
      "pos_iva_registro",
      "pos_lineas_venta",
      "pos_ventas",
    ]);

    setArcaClientForTests(fake);
    expect(getArcaClient()).toBe(fake);

    fake.pushFailure({ kind: "timeout_after_auth" });
    await expect(
      fake.crearFactura({
        PtoVta: 1,
        CbteTipo: 6,
        invoices: [
          {
            Concepto: 1,
            DocTipo: 99,
            DocNro: 0,
            CbteDesde: 1,
            CbteHasta: 1,
            CbteFch: "20261017",
            ImpTotal: 100,
            ImpTotConc: 0,
            ImpNeto: 82.64,
            ImpOpEx: 0,
            ImpTrib: 0,
            ImpIVA: 17.36,
            MonId: "PES",
            MonCotiz: 1,
          },
        ],
      }),
    ).rejects.toThrow(/despues de autorizar/);
    expect(fake.authorizations).toBe(1);
    expect(await fake.ultimoComprobante(1, 6)).toBe(1);

    const found = await fake.consultarComprobante(6, 1, 1);
    expect(found.ResultGet?.CodAutorizacion).toBeTruthy();
    expect(found.ResultGet?.ImpTotal).toBe(100);

    fake.pushFailure({ kind: "timeout_before_auth" });
    await expect(
      fake.crearFactura({
        PtoVta: 1,
        CbteTipo: 6,
        invoices: [
          {
            Concepto: 1,
            DocTipo: 99,
            DocNro: 0,
            CbteDesde: 2,
            CbteHasta: 2,
            CbteFch: "20261017",
            ImpTotal: 100,
            ImpTotConc: 0,
            ImpNeto: 82.64,
            ImpOpEx: 0,
            ImpTrib: 0,
            ImpIVA: 17.36,
            MonId: "PES",
            MonCotiz: 1,
          },
        ],
      }),
    ).rejects.toThrow(/antes de autorizar/);
    expect(fake.authorizations).toBe(1);
    const missing = await fake.consultarComprobante(6, 1, 2);
    expect(missing.Errors?.Err).toMatchObject({ Code: 602 });

    fake.pushFailure({ kind: "reject" });
    const rejected = await fake.crearFactura({
      PtoVta: 1,
      CbteTipo: 6,
      invoices: [
        {
          Concepto: 1,
          DocTipo: 99,
          DocNro: 0,
          CbteDesde: 2,
          CbteHasta: 2,
          CbteFch: "20261017",
          ImpTotal: 100,
          ImpTotConc: 0,
          ImpNeto: 82.64,
          ImpOpEx: 0,
          ImpTrib: 0,
          ImpIVA: 17.36,
          MonId: "PES",
          MonCotiz: 1,
        },
      ],
    });
    expect(rejected.FeDetResp.FECAEDetResponse).toMatchObject({ Resultado: "R" });

    fake.pushFailure({ kind: "numbering" });
    await expect(fake.facturar({ ptoVta: 1, cbteTipo: 6, items: [{ neto: 100 }] })).rejects.toMatchObject({
      errors: [expect.objectContaining({ code: 10016 })],
    });
  });
});
