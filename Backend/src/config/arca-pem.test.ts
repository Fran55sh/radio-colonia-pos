import { describe, expect, it } from "vitest";
import { normalizePem, validateArcaPem } from "./arca-pem.js";

describe("normalizePem", () => {
  it("expands literal \\n in inline env", () => {
    const raw = "-----BEGIN CERT-----\\nABC\\n-----END CERT-----";
    expect(normalizePem(raw)).toBe("-----BEGIN CERT-----\nABC\n-----END CERT-----");
  });

  it("wraps single-line PEM body to 64 columns", () => {
    const body = "A".repeat(70);
    const raw = `-----BEGIN CERTIFICATE----- ${body} -----END CERTIFICATE-----`;
    const out = normalizePem(raw);
    expect(out.startsWith("-----BEGIN CERTIFICATE-----\n")).toBe(true);
    expect(out.endsWith("\n-----END CERTIFICATE-----")).toBe(true);
    expect(out.split("\n").length).toBeGreaterThan(2);
  });
});

describe("validateArcaPem", () => {
  it("rejects garbage PEM", () => {
    const r = validateArcaPem("not-a-cert", "not-a-key");
    expect(r.certOk).toBe(false);
    expect(r.keyOk).toBe(false);
  });
});
