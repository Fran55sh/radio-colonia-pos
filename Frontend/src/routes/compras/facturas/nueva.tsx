import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { InvoiceReviewTable } from "@/components/compras/InvoiceReviewTable";
import { ProductPickerDialog } from "@/components/compras/ProductPickerDialog";
import { Button } from "@/components/ui/button";
import {
  cancelarImportacion,
  createImportacionManual,
  ejecutarImportacion,
  fetchAuthConfig,
  fetchImportacion,
  patchImportacionReview,
  type CompraImportacion,
  type EjecutarImportacionResult,
  type NormalizedInvoice,
  type ProductoCaja,
} from "@/lib/api-client";
import { isAuthenticated, setAuthRequired } from "@/lib/auth-session";

export const Route = createFileRoute("/compras/facturas/nueva")({
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
  component: FacturaManualPage,
  head: () => ({ meta: [{ title: "Factura manual — Radio Colonia" }] }),
});

function FacturaManualPage() {
  const navigate = useNavigate();
  const { id: searchId } = Route.useSearch();
  const [importacion, setImportacion] = useState<CompraImportacion | null>(null);
  const [review, setReview] = useState<NormalizedInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<EjecutarImportacionResult | null>(null);
  const [pickIndex, setPickIndex] = useState<number | null>(null);

  const boot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (searchId) {
        const id = Number(searchId);
        const data = await fetchImportacion(id);
        setImportacion(data);
        setReview(data.review_json);
        if (data.estado === "ejecutado") {
          setResult({
            importacion_id: data.id,
            orden_id: data.orden_id ?? 0,
            factura_id: data.factura_id ?? 0,
            items_procesados: data.stats.total_items,
            proveedor_creado: false,
          });
        }
      } else {
        const data = await createImportacionManual();
        setImportacion(data);
        setReview(data.review_json);
        await navigate({
          to: "/compras/facturas/nueva",
          search: { id: String(data.id) },
          replace: true,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar la factura manual");
    } finally {
      setLoading(false);
    }
  }, [navigate, searchId]);

  useEffect(() => {
    void boot();
  }, [boot]);

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
              descripcion: product.nombre,
              encontrado: true,
              requiere_revision: false,
              codigo_proveedor: item.codigo_proveedor || product.codigo_interno,
              alicuota_iva: item.alicuota_iva ?? product.alicuota_iva ?? 21,
            }
          : item,
      ),
    };
    await saveReview(next);
  };

  const handleExecute = async () => {
    if (!importacion || !review) return;
    setExecuting(true);
    setError(null);
    try {
      const updated = await patchImportacionReview(importacion.id, review);
      setImportacion(updated);
      setReview(updated.review_json);
      if (!updated.validation.can_execute) {
        setError("Hay errores que impiden ejecutar. Revisá las líneas marcadas.");
        return;
      }
      const res = await ejecutarImportacion(importacion.id);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al ejecutar");
    } finally {
      setExecuting(false);
    }
  };

  const canExecute =
    importacion?.validation.can_execute &&
    review &&
    review.items.every((i) => i.variant_id && i.codigo_proveedor) &&
    !executing;

  if (result) {
    return (
      <Shell>
        <div className="rounded-xl border border-online/40 bg-online/10 p-6 space-y-3 max-w-5xl mx-auto w-full mt-6">
          <div className="flex items-center gap-2 text-online text-lg font-semibold">
            <CheckCircle2 className="size-6" />
            Factura manual ejecutada
          </div>
          <p className="text-sm text-silver-light">
            OC #{result.orden_id} · Factura #{result.factura_id}
            {result.proveedor_creado ? " · Proveedor creado" : ""}
          </p>
          <p className="text-sm text-silver">
            {result.items_procesados} productos · Stock y costos actualizados
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
      </Shell>
    );
  }

  return (
    <Shell>
      <main className="flex-1 overflow-auto p-4 sm:p-6 max-w-5xl mx-auto w-full space-y-4">
        {error && (
          <div className="rounded-md border border-offline/40 bg-offline/10 text-offline text-sm px-4 py-3 whitespace-pre-wrap">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-silver-light">
            <Loader2 className="size-5 animate-spin text-primary" />
            Preparando factura manual…
          </div>
        )}

        {!loading && review && importacion && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold text-silver-light">Nueva factura manual</h1>
                <p className="text-sm text-silver">
                  Vinculá cada código de proveedor a un SKU. La descripción sale del catálogo.
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
              mode="manual"
              invoice={review}
              onChange={(next) => void saveReview(next)}
              onPickProduct={(idx) => setPickIndex(idx)}
            />
          </div>
        )}
      </main>

      <ProductPickerDialog
        open={pickIndex != null}
        onOpenChange={(open) => {
          if (!open) setPickIndex(null);
        }}
        hint={
          pickIndex != null
            ? review?.items[pickIndex]?.codigo_proveedor ??
              review?.items[pickIndex]?.descripcion
            : undefined
        }
        onSelect={(p) => {
          if (pickIndex == null) return;
          const idx = pickIndex;
          setPickIndex(null);
          void resolveAndSetProduct(idx, p);
        }}
      />
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
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
        <div className="flex-1 text-sm font-semibold text-silver-light">Factura manual</div>
      </header>
      {children}
    </div>
  );
}
