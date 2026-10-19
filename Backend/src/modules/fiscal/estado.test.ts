import { describe, expect, it } from "vitest";
import {
  puedeEnviarAArca,
  puedeEliminarSinFactura,
  puedeReintentar,
  requiereConciliacion,
  transicionPermitida,
} from "./estado.js";

describe("máquina de estados fiscal", () => {
  it("prohíbe salir de emitido", () => {
    for (const hacia of ["pendiente", "enviando", "desconocido", "emitido", "rechazado", "error", "anulado"] as const) {
      expect(transicionPermitida("emitido", hacia)).toBe(false);
    }
  });

  it("permite las transiciones de la sección 6.1", () => {
    expect(transicionPermitida("pendiente", "enviando")).toBe(true);
    expect(transicionPermitida("rechazado", "enviando")).toBe(true);
    expect(transicionPermitida("error", "enviando")).toBe(true);
    expect(transicionPermitida("enviando", "emitido")).toBe(true);
    expect(transicionPermitida("enviando", "desconocido")).toBe(true);
    expect(transicionPermitida("enviando", "rechazado")).toBe(true);
    expect(transicionPermitida("enviando", "error")).toBe(true);
    expect(transicionPermitida("desconocido", "emitido")).toBe(true);
    expect(transicionPermitida("desconocido", "rechazado")).toBe(true);
    expect(transicionPermitida("desconocido", "enviando")).toBe(false);
    expect(transicionPermitida("pendiente", "emitido")).toBe(false);
  });

  it("clasifica reintento y conciliación", () => {
    expect(puedeEnviarAArca("pendiente")).toBe(true);
    expect(puedeEnviarAArca("enviando")).toBe(false);
    expect(puedeReintentar("error", null)).toBe(true);
    expect(puedeReintentar("error", "123")).toBe(false);
    expect(requiereConciliacion("desconocido")).toBe(true);
    expect(requiereConciliacion("rechazado")).toBe(false);
  });

  it("permite eliminar solo ventas sin CAE que no están en vuelo", () => {
    expect(puedeEliminarSinFactura("pendiente", null)).toBe(true);
    expect(puedeEliminarSinFactura("error", null)).toBe(true);
    expect(puedeEliminarSinFactura("rechazado", null)).toBe(true);
    expect(puedeEliminarSinFactura("error", "123")).toBe(false);
    expect(puedeEliminarSinFactura("enviando", null)).toBe(false);
    expect(puedeEliminarSinFactura("desconocido", null)).toBe(false);
    expect(transicionPermitida("pendiente", "anulado")).toBe(true);
    expect(transicionPermitida("enviando", "anulado")).toBe(false);
  });
});
