import { readFileSync } from "fs";
import { resolve } from "path";
import { z } from "zod";

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

const parsed = arcaEnvSchema.parse({
  ARCA_ENABLED: process.env.ARCA_ENABLED,
  ARCA_CUIT: process.env.ARCA_CUIT,
  ARCA_PTO_VTA: process.env.ARCA_PTO_VTA,
  ARCA_PRODUCTION: process.env.ARCA_PRODUCTION,
  ARCA_CERT_PATH: process.env.ARCA_CERT_PATH,
  ARCA_KEY_PATH: process.env.ARCA_KEY_PATH,
  ARCA_CERT: process.env.ARCA_CERT,
  ARCA_KEY: process.env.ARCA_KEY,
});

function loadPem(pathOrContent: string | undefined, inline: string | undefined): string | undefined {
  if (inline?.trim()) return inline.trim();
  if (!pathOrContent?.trim()) return undefined;
  const p = resolve(pathOrContent.trim());
  return readFileSync(p, "utf-8");
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
