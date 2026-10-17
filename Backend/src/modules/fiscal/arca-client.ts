import {
  Arca,
  type FacturaResult,
  type FacturarOpts,
  type FECAESolicitarResult,
  type FECompConsultarResult,
  type InvoiceRequest,
} from "@ramiidv/arca-facturacion";
import { getArcaConfig } from "../../config/arca.js";
import { env } from "../../config/env.js";

/** Subconjunto de Arca que usa el POS. El falso de tests lo implementa. */
export type ArcaFiscalClient = {
  facturar(opts: FacturarOpts): Promise<FacturaResult>;
  crearFactura(request: InvoiceRequest): Promise<FECAESolicitarResult>;
  ultimoComprobante(ptoVta: number, cbteTipo: number): Promise<number>;
  consultarComprobante(
    cbteTipo: number,
    ptoVta: number,
    cbteNro: number,
  ): Promise<FECompConsultarResult>;
};

let client: ArcaFiscalClient | null = null;
let testClient: ArcaFiscalClient | null = null;

export function setArcaClientForTests(next: ArcaFiscalClient | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("setArcaClientForTests solo se usa con NODE_ENV=test");
  }
  testClient = next;
}

export function getArcaClient(): ArcaFiscalClient | null {
  if (testClient) return testClient;

  const config = getArcaConfig();
  if (!config) return null;

  if (!client) {
    client = new Arca({
      cuit: config.cuit,
      cert: config.cert,
      key: config.key,
      production: config.production,
      requestTimeoutMs: env.ARCA_REQUEST_TIMEOUT_MS,
      retries: env.ARCA_RETRIES,
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
  testClient = null;
}
