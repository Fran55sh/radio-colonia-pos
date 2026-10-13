import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());

vi.mock("../../config/db.js", () => ({
  pool: { query },
}));

import { listClientes } from "./service.js";

describe("listClientes", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it("sin búsqueda: ORDER BY created_at DESC, limito 50, devuelve { items, total }", async () => {
    const last = {
      id: 60,
      nombre: "Último",
      documento: null,
      documento_tipo_afip: "CF",
      condicion_iva_receptor_id: 5,
      razon_social: null,
      domicilio_fiscal: null,
      email: null,
      telefono: null,
      created_at: new Date(),
    };
    query
      .mockResolvedValueOnce({ rows: [{ total: "60" }] })
      .mockResolvedValueOnce({ rows: [last] });

    const result = await listClientes(undefined, 50);

    expect(result.total).toBe(60);
    expect(result.items[0]).toEqual(last);
    expect(result.items).toHaveLength(1);

    const countSql = String(query.mock.calls[0][0]);
    const listSql = String(query.mock.calls[1][0]);
    expect(countSql).toContain("COUNT(*)");
    expect(countSql).not.toContain("WHERE");
    expect(listSql).toContain("ORDER BY created_at DESC");
    expect(listSql).toContain("LIMIT $1");
    expect(query.mock.calls[1][1]).toEqual([50]);
  });

  it("búsqueda por nombre usa unaccent e ignora tildes (perez → Pérez)", async () => {
    const perez = {
      id: 1,
      nombre: "Pérez",
      documento: null,
      documento_tipo_afip: "CF",
      condicion_iva_receptor_id: 5,
      razon_social: null,
      domicilio_fiscal: null,
      email: null,
      telefono: null,
      created_at: new Date(),
    };
    query
      .mockResolvedValueOnce({ rows: [{ total: "1" }] })
      .mockResolvedValueOnce({ rows: [perez] });

    const result = await listClientes("perez", 50);

    expect(result.items[0]?.nombre).toBe("Pérez");
    const listSql = String(query.mock.calls[1][0]);
    expect(listSql).toContain("unaccent");
    expect(listSql).toContain("nombre");
    expect(listSql).toContain("razon_social");
    expect(query.mock.calls[0][1]).toEqual(["%perez%"]);
    expect(query.mock.calls[1][1]).toEqual(["%perez%", 50]);
  });

  it("documento con guiones encuentra solo-dígitos y viceversa", async () => {
    const row = {
      id: 2,
      nombre: "ACME",
      documento: "20123456789",
      documento_tipo_afip: "CUIT",
      condicion_iva_receptor_id: 1,
      razon_social: "ACME SA",
      domicilio_fiscal: null,
      email: null,
      telefono: null,
      created_at: new Date(),
    };
    query
      .mockResolvedValueOnce({ rows: [{ total: "1" }] })
      .mockResolvedValueOnce({ rows: [row] });

    const result = await listClientes("20-12345678-9", 50);

    expect(result.items[0]?.documento).toBe("20123456789");
    const listSql = String(query.mock.calls[1][0]);
    expect(listSql).toContain("regexp_replace");
    expect(listSql).toContain("documento");
    expect(query.mock.calls[1][1]).toEqual(["%20-12345678-9%", "%20123456789%", 50]);
  });

  it("búsqueda por teléfono (dígitos) funciona", async () => {
    const row = {
      id: 3,
      nombre: "Tel",
      documento: null,
      documento_tipo_afip: "CF",
      condicion_iva_receptor_id: 5,
      razon_social: null,
      domicilio_fiscal: null,
      email: null,
      telefono: "11-5555-6677",
      created_at: new Date(),
    };
    query
      .mockResolvedValueOnce({ rows: [{ total: "1" }] })
      .mockResolvedValueOnce({ rows: [row] });

    const result = await listClientes("55556677", 50);

    expect(result.items[0]?.telefono).toBe("11-5555-6677");
    const listSql = String(query.mock.calls[1][0]);
    expect(listSql).toContain("telefono");
    expect(query.mock.calls[1][1]).toEqual(["%55556677%", "%55556677%", 50]);
  });

  it("sin dígitos en el término no agrega filtro de documento/teléfono", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ total: "0" }] })
      .mockResolvedValueOnce({ rows: [] });

    await listClientes("solo-texto", 50);

    expect(query.mock.calls[0][1]).toEqual(["%solo-texto%"]);
    expect(query.mock.calls[1][1]).toEqual(["%solo-texto%", 50]);
    const listSql = String(query.mock.calls[1][0]);
    expect(listSql).not.toContain("regexp_replace");
  });
});
