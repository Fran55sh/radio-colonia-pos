/**
 * Gate D1, manual. No forma parte de los tests ni del deploy.
 *
 * Envía una Factura B de $100 @21% con BaseImp 82.64 e Importe 17.36 usando crearFactura.
 * Requiere ARCA_ENABLED=true, ARCA_PRODUCTION=false y certificados de homologación.
 * Si ARCA rechaza la diferencia de 1 centavo, no reintenta: hay que aplicar el plan B
 * (neto ±1 centavo e ImpTotConc) y revisarlo con contabilidad.
 */
import { Arca, CbteTipo, DocTipo } from "@ramiidv/arca-facturacion";
import { getArcaConfig } from "../src/config/arca.js";

const config = getArcaConfig();
if (!config?.enabled) {
  console.error("Gate D1 no corrido: ARCA no está configurado en este entorno.");
  process.exit(2);
}
if (config.production) {
  console.error("Gate D1 abortado: ARCA_PRODUCTION=true. Solo homologación.");
  process.exit(2);
}

const arca = new Arca({
  cuit: config.cuit,
  cert: config.cert,
  key: config.key,
  production: false,
  requestTimeoutMs: 10_000,
  retries: 1,
});

const ultimo = await arca.ultimoComprobante(config.ptoVta, CbteTipo.FACTURA_B);
const nro = ultimo + 1;
const hoy = new Date()
  .toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })
  .replace(/-/g, "");

const result = await arca.crearFactura({
  PtoVta: config.ptoVta,
  CbteTipo: CbteTipo.FACTURA_B,
  invoices: [
    {
      Concepto: 1,
      DocTipo: DocTipo.CONSUMIDOR_FINAL,
      DocNro: 0,
      CbteDesde: nro,
      CbteHasta: nro,
      CbteFch: hoy,
      ImpTotal: 100,
      ImpTotConc: 0,
      ImpNeto: 82.64,
      ImpOpEx: 0,
      ImpTrib: 0,
      ImpIVA: 17.36,
      MonId: "PES",
      MonCotiz: 1,
      CondicionIVAReceptorId: 5,
      Iva: [{ Id: 5, BaseImp: 82.64, Importe: 17.36 }],
    },
  ],
});

console.log(JSON.stringify(result, null, 2));
