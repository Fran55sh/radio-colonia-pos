import { describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { crearEnlaceToken } from "./distribucion/enlace.js";

describe("enlace público de factura", () => {
  it("un token alterado no entrega el PDF y no exige sesión de caja", async () => {
    process.env.INVOICE_SHARE_SECRET = "secreto-publico-de-prueba";
    const app = await buildApp();
    const token = crearEnlaceToken(9, Math.floor(Date.now() / 1000) + 60, process.env.INVOICE_SHARE_SECRET);
    const [body, sig] = token.split(".");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/fiscal/publico/${body}.${sig.slice(0, -1)}x`,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "ENLACE_INVALIDO" });
    await app.close();
    delete process.env.INVOICE_SHARE_SECRET;
  });
});
