import { describe, expect, it } from "vitest";
import { AppError } from "../../../middleware/errors.js";
import { crearEnlaceToken, ttlEnlaceSegundos, verificarEnlaceToken } from "./enlace.js";

const secret = "secreto-de-prueba-16";

describe("enlace firmado de factura", () => {
  it("acepta el token de esa venta y rechaza otro, uno vencido o uno alterado", () => {
    const now = 1_700_000_000;
    const token = crearEnlaceToken(15, now + 60, secret);
    expect(verificarEnlaceToken(token, secret, now)).toEqual({ ventaId: 15 });

    const otra = crearEnlaceToken(16, now + 60, secret);
    expect(verificarEnlaceToken(otra, secret, now).ventaId).not.toBe(15);

    expect(() => verificarEnlaceToken(token, secret, now + 61)).toThrow(AppError);
    expect(() => verificarEnlaceToken(token, secret, now + 61)).toThrow(/venció/);

    const [body, sig] = token.split(".");
    expect(() => verificarEnlaceToken(`${body}.${sig.slice(0, -1)}x`, secret, now)).toThrow(/no es válido/);
    expect(() => verificarEnlaceToken(`${body}x.${sig}`, secret, now)).toThrow(/no es válido/);
  });

  it("acota la vigencia a siete días", () => {
    expect(ttlEnlaceSegundos({ INVOICE_SHARE_TTL_HOURS: "1" })).toBe(3600);
    expect(ttlEnlaceSegundos({ INVOICE_SHARE_TTL_HOURS: "999" })).toBe(7 * 24 * 3600);
  });
});
