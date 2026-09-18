/**
 * Verifica config ARCA + login WSAA (servicio wsfe).
 * Uso: npm run arca:check
 */
import "dotenv/config";
import { Arca } from "@ramiidv/arca-facturacion";
import { getArcaConfig, getArcaDiagnostics, warnIfArcaEnabledButIncomplete } from "../src/config/arca.js";

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
  // Fuerza login WSAA vía consulta liviana (último comprobante en PV/tipo B).
  await arca.ultimoComprobante(config.ptoVta, 6);
  console.log("OK — WSAA login y WSFE respondieron.");
} catch (err) {
  console.error("FALLÓ —", err instanceof Error ? err.message : err);
  console.error(
    "\nSi el error es HTTP 500 en WSAA, revisá:\n" +
      "  1. Cert de HOMO con ARCA_PRODUCTION=false (o prod con true)\n" +
      "  2. Cert generado con acceso al servicio wsfe en AFIP\n" +
      "  3. Cert no vencido\n" +
      "  4. ARCA_CUIT = CUIT del certificado\n" +
      "  5. Estado de AFIP homologación (caídas temporales)",
  );
  process.exit(1);
}
