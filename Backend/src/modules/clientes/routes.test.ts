import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createCliente = vi.hoisted(() => vi.fn());
const listClientes = vi.hoisted(() => vi.fn());
const getCliente = vi.hoisted(() => vi.fn());
const updateCliente = vi.hoisted(() => vi.fn());
const historialCompras = vi.hoisted(() => vi.fn());

vi.mock("./service.js", () => ({
  createCliente,
  listClientes,
  getCliente,
  updateCliente,
  historialCompras,
}));

import { clientesRoutes } from "./routes.js";
import { requireRole } from "../../middleware/auth.js";
import type { AuthContext } from "../../middleware/auth.js";

async function buildApp(role: AuthContext["role"] = "caja") {
  const app = Fastify();
  app.addHook("preHandler", async (request) => {
    request.authContext = { role, sub: "test", via: "dev_open" };
  });
  await app.register(
    async (scoped) => {
      scoped.addHook("preHandler", requireRole("caja"));
      await scoped.register(clientesRoutes);
    },
    { prefix: "/clientes" },
  );
  await app.ready();
  return app;
}

describe("POST /clientes", () => {
  beforeEach(() => {
    createCliente.mockReset();
    listClientes.mockReset();
  });

  it("con rol caja responde 201", async () => {
    const created = {
      id: 10,
      nombre: "Nuevo",
      documento: null,
      documento_tipo_afip: "CF",
      condicion_iva_receptor_id: 5,
      razon_social: null,
      domicilio_fiscal: null,
      email: null,
      telefono: null,
      created_at: new Date().toISOString(),
    };
    createCliente.mockResolvedValue(created);

    const app = await buildApp("caja");
    const res = await app.inject({
      method: "POST",
      url: "/clientes",
      payload: { nombre: "Nuevo", documento_tipo_afip: "CF", condicion_iva_receptor_id: 5 },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: 10, nombre: "Nuevo" });
    await app.close();
  });

  it("GET /clientes devuelve { items, total }", async () => {
    listClientes.mockResolvedValue({ items: [], total: 0 });
    const app = await buildApp("caja");
    const res = await app.inject({ method: "GET", url: "/clientes" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], total: 0 });
    await app.close();
  });
});
