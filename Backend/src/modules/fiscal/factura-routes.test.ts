import Fastify, { type FastifyReply } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../middleware/errors.js";
import { requireRole, type AuthContext } from "../../middleware/auth.js";

const responderPdf = vi.hoisted(() =>
  vi.fn(async (_ventaId: number, reply: FastifyReply) => {
    reply.header("Content-Type", "application/pdf").header("Content-Disposition", 'attachment; filename="Factura-B-0002-00001234.pdf"').send(Buffer.from("%PDF"));
  }),
);
const metaDistribucion = vi.hoisted(() => vi.fn());
const enviarEmailDeVenta = vi.hoisted(() => vi.fn());
const crearEnlaceDeVenta = vi.hoisted(() => vi.fn());

vi.mock("./factura-servicio.js", () => ({
  responderPdf,
  metaDistribucion,
  enviarEmailDeVenta,
  crearEnlaceDeVenta,
  parseVentaId: (raw: string) => {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      const error = new Error("Venta inválida") as Error & { statusCode: number; code: string };
      error.statusCode = 400;
      error.code = "VALIDATION_ERROR";
      throw error;
    }
    return id;
  },
}));

import { fiscalRoutes } from "./routes.js";

async function buildApp(role?: AuthContext["role"]) {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", async (request) => {
      if (role) request.authContext = { role, sub: "test", via: "jwt" };
    });
    scoped.addHook("preHandler", requireRole("caja"));
    await scoped.register(fiscalRoutes);
  });
  await app.ready();
  return app;
}

describe("PDF fiscal con permiso de caja", () => {
  beforeEach(() => {
    responderPdf.mockClear();
  });

  it("sin sesión no entrega el PDF", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/ventas/4/pdf" });
    expect(res.statusCode).toBe(401);
    expect(responderPdf).not.toHaveBeenCalled();
    await app.close();
  });

  it("con rol caja descarga el PDF ya generado y no lo vuelve a pedir al emitir", async () => {
    const app = await buildApp("caja");
    const first = await app.inject({ method: "GET", url: "/ventas/4/pdf" });
    const second = await app.inject({ method: "GET", url: "/ventas/4/pdf" });
    expect(first.statusCode).toBe(200);
    expect(first.headers["content-type"]).toContain("application/pdf");
    expect(first.headers["content-disposition"]).toContain("Factura-B-0002-00001234.pdf");
    expect(second.rawPayload.equals(first.rawPayload)).toBe(true);
    expect(responderPdf).toHaveBeenCalledTimes(2);
    expect(responderPdf).toHaveBeenCalledWith(4, expect.anything());
    await app.close();
  });
});
