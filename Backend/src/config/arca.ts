import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { z } from "zod";
import {
  extractCuitFromCertMeta,
  normalizePem,
  validateArcaPem,
  type PemValidation,
} from "./arca-pem.js";

const WSAA_ENDPOINTS = {
  testing: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
  production: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
} as const;

const arcaEnvSchema = z.object({
  ARCA_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  ARCA_CUIT: z.string().optional(),
  ARCA_PTO_VTA: z.coerce.number().int().positive().optional(),
  ARCA_PRODUCTION: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  ARCA_CERT_PATH: z.string().optional(),
  ARCA_KEY_PATH: z.string().optional(),
  ARCA_CERT: z.string().optional(),
  ARCA_KEY: z.string().optional(),
});

type ParsedArcaEnv = z.infer<typeof arcaEnvSchema>;

let cachedParsed: ParsedArcaEnv | null = null;

function parseArcaEnv(): ParsedArcaEnv {
  if (!cachedParsed) {
    cachedParsed = arcaEnvSchema.parse({
      ARCA_ENABLED: process.env.ARCA_ENABLED,
      ARCA_CUIT: process.env.ARCA_CUIT,
      ARCA_PTO_VTA: process.env.ARCA_PTO_VTA,
      ARCA_PRODUCTION: process.env.ARCA_PRODUCTION,
      ARCA_CERT_PATH: process.env.ARCA_CERT_PATH,
      ARCA_KEY_PATH: process.env.ARCA_KEY_PATH,
      ARCA_CERT: process.env.ARCA_CERT,
      ARCA_KEY: process.env.ARCA_KEY,
    });
  }
  return cachedParsed;
}

/** Test helper: drop cached env parse so subsequent getArcaConfig() re-reads process.env. */
export function resetArcaEnvCacheForTests(): void {
  cachedParsed = null;
}

function loadPem(
  pathOrContent: string | undefined,
  inline: string | undefined,
): string | undefined {
  if (inline?.trim()) return normalizePem(inline);
  if (!pathOrContent?.trim()) return undefined;
  const p = resolve(pathOrContent.trim());
  try {
    if (!existsSync(p)) return undefined;
    return normalizePem(readFileSync(p, "utf-8"));
  } catch {
    return undefined;
  }
}

export type ArcaDiagnostics = {
  wsaa_endpoint: string | null;
  pem_cert_ok: boolean;
  pem_key_ok: boolean;
  cert_valid_to: string | null;
  cert_expired: boolean | null;
  cert_cuit: number | null;
  cuit_matches_cert: boolean | null;
  hints: string[];
};

export function getArcaDiagnostics(): ArcaDiagnostics {
  const parsed = parseArcaEnv();
  const hints: string[] = [];
  if (!parsed.ARCA_ENABLED) {
    return {
      wsaa_endpoint: null,
      pem_cert_ok: false,
      pem_key_ok: false,
      cert_valid_to: null,
      cert_expired: null,
      cert_cuit: null,
      cuit_matches_cert: null,
      hints: ["ARCA_ENABLED no está activo"],
    };
  }

  const production = parsed.ARCA_PRODUCTION ?? false;
  const wsaa_endpoint = production ? WSAA_ENDPOINTS.production : WSAA_ENDPOINTS.testing;
  const cert = loadPem(parsed.ARCA_CERT_PATH, parsed.ARCA_CERT);
  const key = loadPem(parsed.ARCA_KEY_PATH, parsed.ARCA_KEY);

  if (!cert || !key) {
    hints.push("Faltan ARCA_CERT/ARCA_KEY o paths legibles en el contenedor");
    return {
      wsaa_endpoint,
      pem_cert_ok: false,
      pem_key_ok: false,
      cert_valid_to: null,
      cert_expired: null,
      cert_cuit: null,
      cuit_matches_cert: null,
      hints,
    };
  }

  const pem = validateArcaPem(cert, key);
  const certCuit = extractCuitFromCertMeta(pem.certSubject, pem.certSerial);
  const configCuit = parsed.ARCA_CUIT?.replace(/\D/g, "");
  let cuitMatches: boolean | null = null;
  if (certCuit && configCuit?.length === 11) {
    cuitMatches = certCuit === Number(configCuit);
    if (!cuitMatches) {
      hints.push(
        `ARCA_CUIT (${configCuit}) no coincide con el CUIT del certificado (${certCuit})`,
      );
    }
  }

  if (!pem.certOk) {
    hints.push(`Certificado PEM inválido: ${pem.certError ?? "error desconocido"}`);
  }
  if (!pem.keyOk) {
    hints.push(`Clave privada PEM inválida: ${pem.keyError ?? "error desconocido"}`);
  }
  if (pem.certExpired === true) {
    hints.push("El certificado está vencido — generá uno nuevo en AFIP");
  }
  if (production && pem.certOk) {
    hints.push("Producción: el cert debe ser de computador de producción (no homologación)");
  }
  if (!production && pem.certOk) {
    hints.push("Homologación: el cert debe ser de computador de testing/homologación");
  }

  return {
    wsaa_endpoint,
    pem_cert_ok: pem.certOk,
    pem_key_ok: pem.keyOk,
    cert_valid_to: pem.certValidTo,
    cert_expired: pem.certExpired,
    cert_cuit: certCuit,
    cuit_matches_cert: cuitMatches,
    hints,
  };
}

function logPemProblems(pem: PemValidation, configCuit: string | undefined): void {
  const issues: string[] = [];
  if (!pem.certOk) issues.push(`cert: ${pem.certError}`);
  if (!pem.keyOk) issues.push(`key: ${pem.keyError}`);
  if (pem.certExpired === true) issues.push("certificado vencido");
  const certCuit = extractCuitFromCertMeta(pem.certSubject, pem.certSerial);
  const cuitDigits = configCuit?.replace(/\D/g, "");
  if (certCuit && cuitDigits?.length === 11 && certCuit !== Number(cuitDigits)) {
    issues.push(`CUIT config (${cuitDigits}) ≠ CUIT cert (${certCuit})`);
  }
  if (issues.length > 0) {
    console.warn(`[ARCA] Problemas con certificados — WSAA puede fallar (HTTP 500): ${issues.join("; ")}`);
  }
}

export type ArcaConfig = {
  enabled: boolean;
  cuit: number;
  ptoVta: number;
  production: boolean;
  cert: string;
  key: string;
  ambiente: "dev" | "prod";
};

export function getArcaConfig(): ArcaConfig | null {
  const parsed = parseArcaEnv();
  if (!parsed.ARCA_ENABLED) return null;

  const cert = loadPem(parsed.ARCA_CERT_PATH, parsed.ARCA_CERT);
  const key = loadPem(parsed.ARCA_KEY_PATH, parsed.ARCA_KEY);
  const cuitStr = parsed.ARCA_CUIT?.replace(/\D/g, "");
  const ptoVta = parsed.ARCA_PTO_VTA;

  if (!cuitStr || cuitStr.length !== 11 || !ptoVta || !cert || !key) {
    return null;
  }

  return {
    enabled: true,
    cuit: Number(cuitStr),
    ptoVta,
    production: parsed.ARCA_PRODUCTION ?? false,
    cert,
    key,
    ambiente: parsed.ARCA_PRODUCTION ? "prod" : "dev",
  };
}

export function isArcaConfigured(): boolean {
  return getArcaConfig() !== null;
}

/**
 * Log a clear warning when ARCA_ENABLED=true but CUIT/PV/certs are incomplete.
 * No-op when disabled (avoids noise in local/dev without fiscal).
 */
export function warnIfArcaEnabledButIncomplete(): void {
  const parsed = parseArcaEnv();
  if (!parsed.ARCA_ENABLED) return;

  const config = getArcaConfig();
  if (!config) {
    const missing: string[] = [];
    const cuitStr = parsed.ARCA_CUIT?.replace(/\D/g, "");
    if (!cuitStr || cuitStr.length !== 11) missing.push("ARCA_CUIT (11 dígitos)");
    if (!parsed.ARCA_PTO_VTA) missing.push("ARCA_PTO_VTA");
    const cert = loadPem(parsed.ARCA_CERT_PATH, parsed.ARCA_CERT);
    const key = loadPem(parsed.ARCA_KEY_PATH, parsed.ARCA_KEY);
    if (!cert) missing.push("ARCA_CERT / ARCA_CERT_PATH");
    if (!key) missing.push("ARCA_KEY / ARCA_KEY_PATH");

    console.warn(
      `[ARCA] ARCA_ENABLED=true pero configuración incompleta — no se emitirán comprobantes. Falta: ${missing.join(", ")}`,
    );
    return;
  }

  const pem = validateArcaPem(config.cert, config.key);
  logPemProblems(pem, parsed.ARCA_CUIT);

  const wsaa = config.production ? WSAA_ENDPOINTS.production : WSAA_ENDPOINTS.testing;
  console.info(
    `[ARCA] Configurado — ambiente=${config.ambiente} WSAA=${wsaa} PV=${config.ptoVta} CUIT=${config.cuit}`,
  );
}
