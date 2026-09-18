/**
 * patch-package solo parchea node_modules/@ramiidv/arca-common.
 * Si npm anida otra copia bajo arca-facturacion, aplicamos el mismo fix.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  join(root, "node_modules/@ramiidv/arca-common/dist/soap-client.js"),
  join(
    root,
    "node_modules/@ramiidv/arca-facturacion/node_modules/@ramiidv/arca-common/dist/soap-client.js",
  ),
];

const SOAP_ACTION_OLD = "if (opts?.soapAction) {";
const SOAP_ACTION_NEW =
  "// WSAA/AFIP exige el header aunque sea vacío (SOAPAction: \"\").\n    if (opts && 'soapAction' in opts) {";

const HTTP500_OLD = `            if (!response.ok) {
                if (isRetryable(undefined, response.status) && attempt < maxRetries) {
                    lastError = new ArcaSoapError(\`HTTP \${response.status}: \${response.statusText}\`, response.status);
                    continue;
                }`;

const HTTP500_NEW = `            if (!response.ok) {
                const taOcupado = /alreadyAuthenticated|ya posee un TA valido/i.test(responseText);
                if (taOcupado) {
                    const err = new ArcaSoapError('WSAA: TA ya activo para este certificado (alreadyAuthenticated). No ejecute arca:check en paralelo a la API; espere unos minutos y reintente desde caja.', response.status);
                    onEvent?.({ type: 'request:error', endpoint, method: methodName, error: err });
                    throw err;
                }
                if (isRetryable(undefined, response.status) && attempt < maxRetries) {
                    lastError = new ArcaSoapError(\`HTTP \${response.status}: \${response.statusText}\`, response.status);
                    continue;
                }`;

function patchFile(file) {
  if (!existsSync(file)) return "missing";
  let src = readFileSync(file, "utf8");
  let changed = false;

  if (!src.includes("'soapAction' in opts") && src.includes(SOAP_ACTION_OLD)) {
    src = src.replace(SOAP_ACTION_OLD, SOAP_ACTION_NEW);
    changed = true;
  }

  if (!src.includes("taOcupado") && src.includes(HTTP500_OLD)) {
    src = src.replace(HTTP500_OLD, HTTP500_NEW);
    changed = true;
  }

  if (changed) {
    writeFileSync(file, src, "utf8");
    console.log(`[ensure-arca-common-patch] parcheado ${file}`);
    return "patched";
  }

  if (src.includes("'soapAction' in opts")) return "ok";
  console.warn(`[ensure-arca-common-patch] sin cambios en ${file}`);
  return "unchanged";
}

for (const file of targets) {
  patchFile(file);
}
