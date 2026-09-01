import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, Upload } from "lucide-react";
import { InvoiceReviewTable } from "@/components/compras/InvoiceReviewTable";
import { ProductPickerDialog } from "@/components/compras/ProductPickerDialog";
import { Button } from "@/components/ui/button";
import {
  cancelarImportacion,
  ejecutarImportacion,
  fetchAuthConfig,
  fetchImportacion,
  patchImportacionReview,
  uploadFacturaPdf,
  uploadFacturaTexto,
  type CompraImportacion,
  type EjecutarImportacionResult,
  type NormalizedInvoice,
  type ProductoCaja,
} from "@/lib/api-client";
import { isAuthenticated, setAuthRequired } from "@/lib/auth-session";

type WizardStep = "upload" | "processing" | "review" | "done";
type UploadMode = "pdf" | "text";

export const Route = createFileRoute("/compras/importar")({
  validateSearch: (search: Record<string, unknown>): { id?: string } => ({
    id: typeof search.id === "string" ? search.id : undefined,
  }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    try {
      const cfg = await fetchAuthConfig();
      setAuthRequired(cfg.auth_required);
      if (cfg.auth_required && !isAuthenticated()) {
        throw redirect({ to: "/login" });
      }
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
      if (!isAuthenticated()) throw redirect({ to: "/login" });
    }
  },
  component: ImportarFacturaWizard,
  head: () => ({ meta: [{ title: "Importar factura — Radio Colonia" }] }),
});

function ImportarFacturaWizard() {
  const navigate = useNavigate();
  const { id: searchId } = Route.useSearch();
  const [step, setStep] = useState<WizardStep>("upload");
  const [uploadMode, setUploadMode] = useState<UploadMode>("pdf");
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [importacion, setImportacion] = useState<CompraImportacion | null>(null);
  const [review, setReview] = useState<NormalizedInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<EjecutarImportacionResult | null>(null);
  const [pickIndex, setPickIndex] = useState<number | null>(null);
  const [statusLines, setStatusLines] = useState<string[]>([]);

  useEffect(() => {
    if (!searchId) return;
    const id = Number(searchId);
    if (!Number.isFinite(id)) return;
    void (async () => {
      try {
        setStep("processing");
        const data = await fetchImportacion(id);
        setImportacion(data);
        setReview(data.review_json);
        if (data.estado === "ejecutado") {
          setResult({
            importacion_id: data.id,
            orden_id: data.orden_id ?? 0,
            factura_id: data.factura_id ?? 0,
            items_procesados: data.stats.total_items,
          });
          setStep("done");
        } else {
          setStep("review");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo cargar la importación");
        setStep("upload");
      }
    })();
  }, [searchId]);

  const finishImport = useCallback(
    async (data: CompraImportacion, sourceLabel: string) => {
      setStatusLines((s) => [
        ...s,
        `✓ ${sourceLabel}`,
        data.proveedor_id || data.review_json.proveedor.cuit
          ? "✓ Datos de proveedor encontrados"
          : "⚠ Proveedor requiere revisión",
        `✓ ${data.stats.total_items} productos detectados`,
        `✓ ${data.stats.matched_items} productos identificados`,
        data.stats.pending_items > 0
          ? `⚠ ${data.stats.pending_items} productos requieren revisión`
          : "✓ Todos los productos identificados",
      ]);
      setImportacion(data);
      setReview(data.review_json);
      await navigate({
        to: "/compras/importar",
        search: { id: String(data.id) },
        replace: true,
      });
      setTimeout(() => setStep("review"), 600);
    },
    [navigate],
  );

  const processFile = useCallback(async () => {
    if (!file) return;
    setError(null);
    setStep("processing");
    setStatusLines(["Leyendo PDF…"]);
    try {
      setStatusLines((s) => [...s, "Extrayendo datos de factura…"]);
      const data = await uploadFacturaPdf(file);
      await finishImport(data, "PDF leído");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al procesar el PDF");
      setUploadMode("text");
      setStep("upload");
    }
  }, [file, finishImport]);

  const processText = useCallback(async () => {
    const text = pastedText.trim();
    if (text.length < 20) {
      setError("Pegá al menos unas líneas de la factura (CUIT, ítems, totales).");
      return;
    }
    setError(null);
    setStep("processing");
    setStatusLines(["Procesando texto pegado…"]);
    try {
      const data = await uploadFacturaTexto({ text, label: file?.name ?? "texto-manual.txt" });
      await finishImport(data, "Texto procesado");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al procesar el texto");
      setStep("upload");
    }
  }, [file?.name, finishImport, pastedText]);

  const saveReview = async (next: NormalizedInvoice) => {
    setReview(next);
    if (!importacion) return;
    setSaving(true);
    try {
      const updated = await patchImportacionReview(importacion.id, next);
      setImportacion(updated);
      setReview(updated.review_json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const resolveAndSetProduct = async (index: number, product: ProductoCaja) => {
    if (!review || !importacion) return;
    const variantId = product.variant_id;
    if (!variantId) {
      setError("El producto seleccionado no tiene variant_id. Actualizá el catálogo.");
      return;
    }
    const next: NormalizedInvoice = {
      ...review,
      items: review.items.map((item, i) =>
        i === index
          ? {
              ...item,
              variant_id: variantId,
              sku: product.codigo_interno,
              producto_nombre: product.nombre,
              encontrado: true,
              requiere_revision: false,
              codigo_proveedor: item.codigo_proveedor || product.codigo_interno,
            }
          : item,
      ),
    };
    await saveReview(next);
  };

  const onPickProduct = (product: ProductoCaja) => {
    if (pickIndex == null || !review) return;
    const idx = pickIndex;
    setPickIndex(null);
    void resolveAndSetProduct(idx, product);
  };

  const handleExecute = async () => {
    if (!importacion || !review) return;
    setExecuting(true);
    setError(null);
    try {
      // Persist latest review first
      const updated = await patchImportacionReview(importacion.id, review);
      setImportacion(updated);
      if (!updated.validation.can_execute) {
        setError("Hay errores que impiden ejecutar. Revisá las líneas marcadas.");
        setExecuting(false);
        return;
      }
      const res = await ejecutarImportacion(importacion.id);
      setResult(res);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al ejecutar");
    } finally {
      setExecuting(false);
    }
  };

  const canExecute =
    importacion?.validation.can_execute &&
    review &&
    review.items.every((i) => i.variant_id) &&
    !executing;

  return (
    <div className="min-h-[100dvh] bg-midnight text-foreground font-mono flex flex-col">
      <header className="h-14 shrink-0 border-b border-border bg-charcoal flex items-center px-4 gap-3">
        <Link
          to="/compras"
          className="flex items-center gap-1 text-xs text-silver hover:text-primary"
        >
          <ArrowLeft className="size-4" />
          Compras
        </Link>
        <div className="flex-1 text-sm font-semibold text-silver-light">
          Nueva carga de factura
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 sm:p-6 max-w-5xl mx-auto w-full space-y-4">
        {error && (
          <div className="rounded-md border border-offline/40 bg-offline/10 text-offline text-sm px-4 py-3 whitespace-pre-wrap">
            {error}
          </div>
        )}

        {step === "upload" && (
          <div className="rounded-xl border border-border bg-charcoal/40 p-6 space-y-4">
            <h1 className="text-lg font-semibold text-silver-light">Nueva carga de factura</h1>

            <div className="flex gap-2 border-b border-border pb-3">
              <button
                type="button"
                onClick={() => setUploadMode("pdf")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  uploadMode === "pdf"
                    ? "bg-primary text-primary-foreground"
                    : "text-silver hover:text-silver-light hover:bg-charcoal"
                }`}
              >
                Subir PDF
              </button>
              <button
                type="button"
                onClick={() => setUploadMode("text")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  uploadMode === "text"
                    ? "bg-primary text-primary-foreground"
                    : "text-silver hover:text-silver-light hover:bg-charcoal"
                }`}
              >
                Pegar texto
              </button>
            </div>

            {uploadMode === "pdf" ? (
              <>
                <p className="text-sm text-silver">
                  Subí el PDF de la factura electrónica. Si el PDF no se puede leer automáticamente,
                  podés cambiar a &quot;Pegar texto&quot; y usar el texto que extraigas (ej. con Gemini).
                </p>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-silver file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground"
                />
                <Button
                  disabled={!file}
                  onClick={() => void processFile()}
                  className="bg-primary text-primary-foreground gap-2"
                >
                  <Upload className="size-4" />
                  Procesar factura
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-silver">
                  Pegá el texto completo de la factura (CUIT, ítems, totales). Podés copiarlo desde
                  Gemini u otro lector si el PDF no se procesa solo.
                </p>
                <textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  rows={14}
                  placeholder={
                    "FACTURA A\nCUIT: 30-12345678-9\nRazón Social: ...\nComprobante: 0001-00001234\n..."
                  }
                  className="w-full rounded-md border border-border bg-midnight px-3 py-2 text-sm text-silver-light placeholder:text-silver/60 focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <Button
                  disabled={pastedText.trim().length < 20}
                  onClick={() => void processText()}
                  className="bg-primary text-primary-foreground gap-2"
                >
                  Procesar texto
                </Button>
              </>
            )}
          </div>
        )}

        {step === "processing" && (
          <div className="rounded-xl border border-border bg-charcoal/40 p-6 space-y-3">
            <div className="flex items-center gap-2 text-silver-light">
              <Loader2 className="size-5 animate-spin text-primary" />
              Procesando factura…
            </div>
            <ul className="text-sm text-silver space-y-1">
              {statusLines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        )}

        {step === "review" && review && importacion && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold text-silver-light">Verificar factura</h1>
                <p className="text-sm text-silver">
                  {importacion.stats.total_items} productos · {importacion.stats.matched_items}{" "}
                  correctos · {importacion.stats.pending_items} requieren revisión
                  {saving ? " · Guardando…" : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="border-border"
                  onClick={() =>
                    void cancelarImportacion(importacion.id).then(() =>
                      navigate({ to: "/compras" }),
                    )
                  }
                >
                  Cancelar
                </Button>
                <Button
                  disabled={!canExecute}
                  onClick={() => void handleExecute()}
                  className="bg-primary text-primary-foreground"
                >
                  {executing ? "Ejecutando…" : "Confirmar y ejecutar orden"}
                </Button>
              </div>
            </div>

            {(importacion.validation.issues ?? []).length > 0 && (
              <ul className="text-xs space-y-1 rounded-md border border-border p-3">
                {importacion.validation.issues.map((iss, i) => (
                  <li
                    key={i}
                    className={iss.level === "error" ? "text-offline" : "text-amber-400"}
                  >
                    {iss.level === "error" ? "Error" : "Aviso"}: {iss.message}
                  </li>
                ))}
              </ul>
            )}

            <InvoiceReviewTable
              invoice={review}
              onChange={(next) => void saveReview(next)}
              onPickProduct={(idx) => setPickIndex(idx)}
            />
          </div>
        )}

        {step === "done" && result && (
          <div className="rounded-xl border border-online/40 bg-online/10 p-6 space-y-3">
            <div className="flex items-center gap-2 text-online text-lg font-semibold">
              <CheckCircle2 className="size-6" />
              Orden ejecutada correctamente
            </div>
            <p className="text-sm text-silver-light">
              Factura vinculada · OC #{result.orden_id} · Factura #{result.factura_id}
            </p>
            <p className="text-sm text-silver">
              {result.items_procesados} productos procesados · Stock actualizado
            </p>
            <div className="flex gap-2 pt-2">
              <Button asChild className="bg-primary text-primary-foreground">
                <Link to="/compras">Volver a compras</Link>
              </Button>
              <Button asChild variant="outline" className="border-border">
                <Link to="/">Ir a caja</Link>
              </Button>
            </div>
          </div>
        )}
      </main>

      <ProductPickerDialog
        open={pickIndex != null}
        onOpenChange={(open) => {
          if (!open) setPickIndex(null);
        }}
        hint={pickIndex != null ? review?.items[pickIndex]?.descripcion : undefined}
        onSelect={(p) => onPickProduct(p)}
      />
    </div>
  );
}
