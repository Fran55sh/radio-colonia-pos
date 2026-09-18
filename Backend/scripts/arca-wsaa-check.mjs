/**
 * Verifica config ARCA + login WSAA (servicio wsfe).
 * Producción: node scripts/arca-wsaa-check.mjs (usa dist/)
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Arca } from "@ramiidv/arca-facturacion";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (existsSync(join(root, ".env"))) {
  await import("dotenv/config");
}

const arcaConfigPath = join(root, "dist/config/arca.js");
if (!existsSync(arcaConfigPath)) {
  console.error("Falta dist/config/arca.js — ejecutá npm run build antes de arca:check.");
  process.exit(1);
}

const { getArcaConfig, getArcaDiagnostics, warnIfArcaEnabledButIncomplete } =
  await import("../dist/config/arca.js");

warnIfArcaEnabledButIncomplete();

const config = getArcaConfig();
const diagnostics = getArcaDiagnostics();

console.log("--- ARCA diagnostics ---");
console.log(JSON.stringify(diagnostics, null, 2));

if (!config) {
  console.error("ARCA no configurado. Revisá ARCA_ENABLED, CUIT, PV y certificados.");
  process.exit(1);
}

if (!diagnostics.pem_cert_ok || !diagnostics.pem_key_ok) {
  console.error("PEM inválido. Corregí ARCA_CERT/ARCA_KEY antes de probar WSAA.");
  process.exit(1);
}

const arca = new Arca({
  cuit: config.cuit,
  cert: config.cert,
  key: config.key,
  production: config.production,
  onEvent: (e) => {
    if (e.type === "request:error" || e.type === "request:retry") {
      console.warn("[WSAA]", e);
    }
  },
});

try {
  const n = await arca.ultimoComprobante(config.ptoVta, 6);
  console.log(`OK — WSAA login y WSFE respondieron (ultimo Factura B PV${config.ptoVta}: ${n}).`);
} catch (err) {
  console.error("FALLÓ —", err instanceof Error ? err.message : err);
  process.exit(1);
}
