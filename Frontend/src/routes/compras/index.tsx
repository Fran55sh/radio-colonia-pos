import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileUp, ArrowLeft, FilePlus2 } from "lucide-react";
import {
  fetchAuthConfig,
  fetchImportaciones,
  fetchOrdenesCompra,
} from "@/lib/api-client";
import { isAuthenticated, setAuthRequired } from "@/lib/auth-session";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/compras/")({
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
  component: ComprasHome,
  head: () => ({ meta: [{ title: "Compras — Radio Colonia" }] }),
});

function origenLabel(origen?: string) {
  if (origen === "manual") return "Manual";
  if (origen === "texto") return "Texto";
  return "PDF";
}

function ComprasHome() {
  const importsQ = useQuery({
    queryKey: ["compras-importaciones"],
    queryFn: fetchImportaciones,
  });
  const ordenesQ = useQuery({
    queryKey: ["compras-ordenes"],
    queryFn: fetchOrdenesCompra,
  });

  return (
    <div className="min-h-[100dvh] bg-midnight text-foreground font-mono flex flex-col">
      <header className="h-14 shrink-0 border-b border-border bg-charcoal flex items-center px-4 gap-3">
        <Link
          to="/"
          className="flex items-center gap-1 text-xs text-silver hover:text-primary"
        >
          <ArrowLeft className="size-4" />
          Caja
        </Link>
        <div className="flex-1 text-sm font-semibold text-silver-light">Compras</div>
        <Button asChild variant="outline" className="border-border gap-2 hidden sm:inline-flex">
          <Link to="/compras/facturas/nueva">
            <FilePlus2 className="size-4" />
            Nueva factura manual
          </Link>
        </Button>
        <Button asChild className="bg-primary text-primary-foreground hover:bg-accent gap-2">
          <Link to="/compras/importar">
            <FileUp className="size-4" />
            Importar factura
          </Link>
        </Button>
      </header>

      <main className="flex-1 overflow-auto p-4 sm:p-6 space-y-8 max-w-5xl mx-auto w-full">
        <div className="sm:hidden">
          <Button asChild variant="outline" className="w-full border-border gap-2">
            <Link to="/compras/facturas/nueva">
              <FilePlus2 className="size-4" />
              Nueva factura manual
            </Link>
          </Button>
        </div>

        <section>
          <h2 className="text-xs uppercase tracking-widest text-silver font-bold mb-3">
            Importaciones recientes
          </h2>
          <div className="rounded-lg border border-border overflow-hidden divide-y divide-border/50">
            {(importsQ.data ?? []).length === 0 && (
              <p className="p-4 text-sm text-silver">Todavía no hay importaciones.</p>
            )}
            {(importsQ.data ?? []).map((imp) => {
              const dest =
                imp.origen === "manual"
                  ? ({ to: "/compras/facturas/nueva" as const, search: { id: String(imp.id) } })
                  : ({ to: "/compras/importar" as const, search: { id: String(imp.id) } });
              return (
                <Link
                  key={imp.id}
                  {...dest}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-charcoal/60"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-silver-light truncate">
                      #{imp.id} · {origenLabel(imp.origen)} ·{" "}
                      {imp.pdf_original_name ?? "factura"}
                    </div>
                    <div className="text-[11px] text-silver">
                      {imp.proveedor_nombre ?? "Sin proveedor"} · {imp.stats.matched_items}/
                      {imp.stats.total_items} productos · {imp.estado}
                    </div>
                  </div>
                  <span className="text-[11px] text-primary shrink-0">Abrir</span>
                </Link>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-widest text-silver font-bold mb-3">
            Órdenes de compra
          </h2>
          <div className="rounded-lg border border-border overflow-hidden divide-y divide-border/50">
            {(ordenesQ.data ?? []).length === 0 && (
              <p className="p-4 text-sm text-silver">Sin órdenes todavía.</p>
            )}
            {(ordenesQ.data ?? []).map((oc) => (
              <div key={oc.id} className="px-4 py-3 flex justify-between gap-3">
                <div>
                  <div className="text-sm text-silver-light">
                    OC #{oc.id} · {oc.proveedor_nombre}
                  </div>
                  <div className="text-[11px] text-silver">
                    {oc.estado} · {oc.origen} · {oc.lineas_count} líneas
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
