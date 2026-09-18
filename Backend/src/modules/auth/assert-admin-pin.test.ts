import { describe, expect, it, vi, beforeEach } from "vitest";

const pinsEqualCalls: Array<[string, string]> = [];

vi.mock("../../config/env.js", () => ({
  env: {
    POS_ADMIN_PIN: "secret-admin",
    POS_ACCESS_PIN: "caja-pin",
    POS_COMPRAS_PIN: undefined,
    POS_DEFAULT_ROLE: "caja",
    NODE_ENV: "test",
  },
}));

// Import after mock
import { assertAdminPin } from "./service.js";
import { AppError } from "../../middleware/errors.js";

describe("assertAdminPin", () => {
  beforeEach(() => {
    pinsEqualCalls.length = 0;
  });

  it("acepta PIN admin correcto", () => {
    expect(() => assertAdminPin("secret-admin")).not.toThrow();
  });

  it("rechaza PIN vacío", () => {
    expect(() => assertAdminPin("")).toThrow(AppError);
    try {
      assertAdminPin(undefined);
    } catch (e) {
      expect((e as AppError).code).toBe("CAJA_PIN_INVALIDO");
    }
  });

  it("rechaza PIN incorrecto", () => {
    try {
      assertAdminPin("wrong-pin");
      expect.fail("should throw");
    } catch (e) {
      expect((e as AppError).code).toBe("CAJA_PIN_INVALIDO");
    }
  });
});
