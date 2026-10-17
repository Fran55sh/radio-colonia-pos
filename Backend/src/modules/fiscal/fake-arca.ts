import {
  ArcaAuthError,
  ArcaSoapError,
  ArcaWSFEError,
  type FacturaResult,
  type FacturarOpts,
  type FECAESolicitarResult,
  type FECompConsultarResult,
  type InvoiceRequest,
} from "@ramiidv/arca-facturacion";

export type FakeFailure =
  | { kind: "timeout_after_auth" }
  | { kind: "timeout_before_auth" }
  | { kind: "reject"; code?: number; msg?: string }
  | { kind: "numbering" }
  | { kind: "auth" }
  | { kind: "soap"; statusCode?: number }
  | { kind: "slow"; ms: number };

export type ArcaBookEntry = {
  ptoVta: number;
  cbteTipo: number;
  cbteNro: number;
  cae: string;
  caeVto: string;
  impTotal: number;
  impNeto: number;
  impIva: number;
  docTipo: number;
  docNro: number;
  cbteFch: string;
};

function bookKey(ptoVta: number, cbteTipo: number, cbteNro: number): string {
  return `${ptoVta}:${cbteTipo}:${cbteNro}`;
}

function abortError(message: string): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

/**
 * Cliente ARCA en memoria. Autoriza, rechaza o corta la respuesta
 * según la cola de fallos. Reenviar el mismo número e importe devuelve el mismo CAE.
 */
export class FakeArca {
  readonly book = new Map<string, ArcaBookEntry>();
  crearFacturaCalls = 0;
  facturarCalls = 0;
  consultarCalls = 0;
  authorizations = 0;
  private failureQueue: FakeFailure[] = [];
  private sticky: FakeFailure | null = null;
  private seq = 70000000000000;

  reset(): void {
    this.book.clear();
    this.crearFacturaCalls = 0;
    this.facturarCalls = 0;
    this.consultarCalls = 0;
    this.authorizations = 0;
    this.failureQueue = [];
    this.sticky = null;
    this.seq = 70000000000000;
  }

  /** El próximo crearFactura/facturar consume este fallo una sola vez. */
  pushFailure(failure: FakeFailure): void {
    this.failureQueue.push(failure);
  }

  /** Se aplica en cada envío hasta que se limpia. */
  setStickyFailure(failure: FakeFailure | null): void {
    this.sticky = failure;
  }

  async ultimoComprobante(ptoVta: number, cbteTipo: number): Promise<number> {
    let max = 0;
    for (const entry of this.book.values()) {
      if (entry.ptoVta === ptoVta && entry.cbteTipo === cbteTipo) {
        max = Math.max(max, entry.cbteNro);
      }
    }
    return max;
  }

  async consultarComprobante(
    cbteTipo: number,
    ptoVta: number,
    cbteNro: number,
  ): Promise<FECompConsultarResult> {
    this.consultarCalls += 1;
    const entry = this.book.get(bookKey(ptoVta, cbteTipo, cbteNro));
    if (!entry) {
      return {
        Errors: { Err: { Code: 602, Msg: "Comprobante inexistente" } },
      } as FECompConsultarResult;
    }
    return {
      ResultGet: {
        Concepto: 1,
        DocTipo: entry.docTipo,
        DocNro: entry.docNro,
        CbteDesde: entry.cbteNro,
        CbteHasta: entry.cbteNro,
        CbteFch: entry.cbteFch,
        ImpTotal: entry.impTotal,
        ImpTotConc: 0,
        ImpNeto: entry.impNeto,
        ImpOpEx: 0,
        ImpTrib: 0,
        ImpIVA: entry.impIva,
        FchServDesde: "",
        FchServHasta: "",
        FchVtoPago: "",
        MonId: "PES",
        MonCotiz: 1,
        Resultado: "A",
        CodAutorizacion: entry.cae,
        EmisionTipo: "CAE",
        FchVto: entry.caeVto,
        FchProceso: entry.cbteFch,
        PtoVta: entry.ptoVta,
        CbteTipo: entry.cbteTipo,
      },
    };
  }

  async crearFactura(request: InvoiceRequest): Promise<FECAESolicitarResult> {
    this.crearFacturaCalls += 1;
    const invoice = request.invoices[0];
    if (!invoice) {
      throw new ArcaWSFEError([{ code: 1, msg: "invoices vacío" }]);
    }
    const failure = this.takeFailure();
    await this.applyDelay(failure);

    if (failure?.kind === "auth") {
      throw new ArcaAuthError("WSAA no disponible");
    }
    if (failure?.kind === "soap") {
      throw new ArcaSoapError("HTTP 500", failure.statusCode ?? 500);
    }
    if (failure?.kind === "numbering") {
      throw new ArcaWSFEError([
        { code: 10016, msg: "El numero o fecha del comprobante no se corresponde" },
      ]);
    }
    if (failure?.kind === "timeout_before_auth") {
      throw abortError("timeout antes de autorizar");
    }

    const key = bookKey(request.PtoVta, request.CbteTipo, invoice.CbteDesde);
    const existing = this.book.get(key);
    if (existing) {
      if (Math.abs(existing.impTotal - invoice.ImpTotal) > 0.001) {
        throw new ArcaWSFEError([
          { code: 10016, msg: "El numero de comprobante ya fue autorizado con otro importe" },
        ]);
      }
      return this.toSolicitar(request, existing, true);
    }

    if (failure?.kind === "reject") {
      return this.rejected(request, invoice.CbteDesde, failure.code ?? 10048, failure.msg ?? "Rechazado");
    }

    const entry: ArcaBookEntry = {
      ptoVta: request.PtoVta,
      cbteTipo: request.CbteTipo,
      cbteNro: invoice.CbteDesde,
      cae: String(this.seq++),
      caeVto: "20261231",
      impTotal: invoice.ImpTotal,
      impNeto: invoice.ImpNeto,
      impIva: invoice.ImpIVA,
      docTipo: invoice.DocTipo,
      docNro: invoice.DocNro,
      cbteFch: invoice.CbteFch,
    };
    this.book.set(key, entry);
    this.authorizations += 1;

    if (failure?.kind === "timeout_after_auth") {
      throw abortError("timeout despues de autorizar");
    }
    return this.toSolicitar(request, entry, false);
  }

  async facturar(opts: FacturarOpts): Promise<FacturaResult> {
    this.facturarCalls += 1;
    const nro = (await this.ultimoComprobante(opts.ptoVta, opts.cbteTipo)) + 1;
    const neto = opts.items.reduce((sum, item) => sum + item.neto, 0);
    const request: InvoiceRequest = {
      PtoVta: opts.ptoVta,
      CbteTipo: opts.cbteTipo,
      invoices: [
        {
          Concepto: 1,
          DocTipo: opts.docTipo ?? 99,
          DocNro: opts.docNro ?? 0,
          CbteDesde: nro,
          CbteHasta: nro,
          CbteFch: "20261017",
          ImpTotal: neto,
          ImpTotConc: 0,
          ImpNeto: neto,
          ImpOpEx: 0,
          ImpTrib: 0,
          ImpIVA: 0,
          MonId: "PES",
          MonCotiz: 1,
          CondicionIVAReceptorId: opts.condicionIva,
        },
      ],
    };
    const raw = await this.crearFactura(request);
    const det = Array.isArray(raw.FeDetResp.FECAEDetResponse)
      ? raw.FeDetResp.FECAEDetResponse[0]
      : raw.FeDetResp.FECAEDetResponse;
    const aprobada = det?.Resultado === "A" && !!det.CAE;
    return {
      aprobada,
      cae: aprobada ? det.CAE : undefined,
      caeVencimiento: aprobada ? det.CAEFchVto : undefined,
      cbteNro: nro,
      ptoVta: opts.ptoVta,
      cbteTipo: opts.cbteTipo,
      importes: { total: neto, neto, iva: 0, exento: 0, noGravado: 0, tributos: 0 },
      observaciones: [],
      raw,
    };
  }

  private takeFailure(): FakeFailure | null {
    if (this.failureQueue.length > 0) return this.failureQueue.shift() ?? null;
    return this.sticky;
  }

  private async applyDelay(failure: FakeFailure | null): Promise<void> {
    if (failure?.kind === "slow") {
      await new Promise((resolve) => setTimeout(resolve, failure.ms));
    }
  }

  private toSolicitar(
    request: InvoiceRequest,
    entry: ArcaBookEntry,
    reproceso: boolean,
  ): FECAESolicitarResult {
    return {
      FeCabResp: {
        Cuit: 20111111112,
        PtoVta: request.PtoVta,
        CbteTipo: request.CbteTipo,
        FchProceso: entry.cbteFch,
        CantReg: 1,
        Resultado: "A",
        Reproceso: reproceso ? "S" : "N",
      },
      FeDetResp: {
        FECAEDetResponse: {
          Concepto: 1,
          DocTipo: entry.docTipo,
          DocNro: entry.docNro,
          CbteDesde: entry.cbteNro,
          CbteHasta: entry.cbteNro,
          CbteFch: entry.cbteFch,
          Resultado: "A",
          CAE: entry.cae,
          CAEFchVto: entry.caeVto,
        },
      },
    };
  }

  private rejected(
    request: InvoiceRequest,
    nro: number,
    code: number,
    msg: string,
  ): FECAESolicitarResult {
    return {
      FeCabResp: {
        Cuit: 20111111112,
        PtoVta: request.PtoVta,
        CbteTipo: request.CbteTipo,
        FchProceso: "",
        CantReg: 1,
        Resultado: "R",
        Reproceso: "N",
      },
      FeDetResp: {
        FECAEDetResponse: {
          Concepto: 1,
          DocTipo: request.invoices[0]?.DocTipo ?? 99,
          DocNro: request.invoices[0]?.DocNro ?? 0,
          CbteDesde: nro,
          CbteHasta: nro,
          CbteFch: request.invoices[0]?.CbteFch ?? "",
          Resultado: "R",
          CAE: "",
          CAEFchVto: "",
          Observaciones: { Obs: { Code: code, Msg: msg } },
        },
      },
    };
  }
}
