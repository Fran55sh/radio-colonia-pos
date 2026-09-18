import { afterEach, describe, expect, it } from "vitest";
import {
  getArcaConfig,
  isArcaConfigured,
  resetArcaEnvCacheForTests,
  warnIfArcaEnabledButIncomplete,
} from "./arca.js";

const ENV_KEYS = [
  "ARCA_ENABLED",
  "ARCA_CUIT",
  "ARCA_PTO_VTA",
  "ARCA_PRODUCTION",
  "ARCA_CERT",
  "ARCA_KEY",
  "ARCA_CERT_PATH",
  "ARCA_KEY_PATH",
] as const;

const saved: Record<string, string | undefined> = {};

function stashEnv() {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
}

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetArcaEnvCacheForTests();
}

function clearArcaEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
  resetArcaEnvCacheForTests();
}

stashEnv();

afterEach(() => {
  restoreEnv();
});

describe("getArcaConfig", () => {
  it("returns null when ARCA_ENABLED is not true", () => {
    clearArcaEnv();
    process.env.ARCA_ENABLED = "false";
    resetArcaEnvCacheForTests();
    expect(getArcaConfig()).toBeNull();
    expect(isArcaConfigured()).toBe(false);
  });

  it("returns null when enabled but incomplete", () => {
    clearArcaEnv();
    process.env.ARCA_ENABLED = "true";
    process.env.ARCA_CUIT = "20123456786";
    resetArcaEnvCacheForTests();
    expect(getArcaConfig()).toBeNull();
  });

  it("loads inline cert/key and reports ambiente=dev when not production", () => {
    clearArcaEnv();
    process.env.ARCA_ENABLED = "true";
    process.env.ARCA_CUIT = "20-12345678-6";
    process.env.ARCA_PTO_VTA = "3";
    process.env.ARCA_PRODUCTION = "false";
    process.env.ARCA_CERT = "-----BEGIN CERT-----\nX\n-----END CERT-----";
    process.env.ARCA_KEY = "-----BEGIN KEY-----\nY\n-----END KEY-----";
    resetArcaEnvCacheForTests();

    const cfg = getArcaConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.cuit).toBe(20123456786);
    expect(cfg!.ptoVta).toBe(3);
    expect(cfg!.production).toBe(false);
    expect(cfg!.ambiente).toBe("dev");
    expect(isArcaConfigured()).toBe(true);
  });

  it("reports ambiente=prod when ARCA_PRODUCTION=true", () => {
    clearArcaEnv();
    process.env.ARCA_ENABLED = "true";
    process.env.ARCA_CUIT = "20123456786";
    process.env.ARCA_PTO_VTA = "1";
    process.env.ARCA_PRODUCTION = "true";
    process.env.ARCA_CERT = "CERT";
    process.env.ARCA_KEY = "KEY";
    resetArcaEnvCacheForTests();

    const cfg = getArcaConfig();
    expect(cfg!.production).toBe(true);
    expect(cfg!.ambiente).toBe("prod");
  });

  it("does not throw when cert path is missing", () => {
    clearArcaEnv();
    process.env.ARCA_ENABLED = "true";
    process.env.ARCA_CUIT = "20123456786";
    process.env.ARCA_PTO_VTA = "1";
    process.env.ARCA_CERT_PATH = "./certs/does-not-exist.crt";
    process.env.ARCA_KEY_PATH = "./certs/does-not-exist.key";
    resetArcaEnvCacheForTests();
    expect(() => getArcaConfig()).not.toThrow();
    expect(getArcaConfig()).toBeNull();
  });

  it("warnIfArcaEnabledButIncomplete logs when enabled but incomplete", () => {
    clearArcaEnv();
    process.env.ARCA_ENABLED = "true";
    resetArcaEnvCacheForTests();
    const warns: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.join(" "));
    };
    try {
      warnIfArcaEnabledButIncomplete();
    } finally {
      console.warn = original;
    }
    expect(warns.some((w) => String(w).includes("ARCA_ENABLED=true"))).toBe(true);
  });
});
