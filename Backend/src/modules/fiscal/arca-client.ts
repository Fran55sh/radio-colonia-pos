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
      onEvent: (e) => {
        if (process.env.NODE_ENV === "development") {
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
