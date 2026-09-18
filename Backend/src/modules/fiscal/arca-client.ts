import { Arca } from "@ramiidv/arca-facturacion";
import { getArcaConfig } from "../../config/arca.js";

let client: Arca | null = null;

export function getArcaClient(): Arca | null {
  const config = getArcaConfig();
  if (!config) return null;

  if (!client) {
    client = new Arca({
      cuit: config.cuit,
      cert: config.cert,
      key: config.key,
      production: config.production,
      retries: 3,
      retryDelayMs: 2_000,
      onEvent: (e) => {
        if (e.type === "request:error") {
          console.warn("[ARCA]", e.type, e);
          return;
        }
        if (process.env.NODE_ENV === "development" || process.env.ARCA_DEBUG === "true") {
          console.log("[ARCA]", e.type, e);
        }
      },
    });
  }
  return client;
}

export function resetArcaClientForTests(): void {
  client = null;
}
