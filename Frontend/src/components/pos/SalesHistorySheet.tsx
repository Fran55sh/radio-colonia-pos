import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { fetchVentaDetalle, fetchVentas, type VentaResumen } from "@/lib/api-client";
import { formatARS } from "@/lib/format-money";
import { FiscalPdfActions } from "./FiscalPdfActions";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function fecha(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

export function SalesHistorySheet({ open, onOpenChange }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const list = useQuery({
    queryKey: ["pos-ventas"],
    queryFn: () => fetchVentas(),
    enabled: open,
  });
  const detail = useQuery({
    queryKey: ["pos-venta", selectedId],
    queryFn: () => fetchVentaDetalle(selectedId!),
    enabled: open && selectedId != null,
  });

  function close(next: boolean) {
    if (!next) setSelectedId(null);
    onOpenChange(next);
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        side="right"
        className="bg-charcoal border-border text-silver-light w-[92vw] sm:max-w-md overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle className="text-silver-light">
            {selectedId == null ? "Ventas" : `Venta #${selectedId}`}
          </SheetTitle>
          <SheetDescription className="text-silver">
            Historial de la caja. El PDF solo está disponible si ARCA autorizó el comprobante.
          </SheetDescription>
        </SheetHeader>

        {selectedId == null ? (
          <Lista
            loading={list.isLoading}
            error={
              list.isError
                ? list.error instanceof Error
                  ? list.error.message
                  : "No se pudieron cargar las ventas"
                : null
            }
            ventas={list.data?.ventas ?? []}
            onRetry={() => void list.refetch()}
            onOpen={setSelectedId}
          />
        ) : (
          <div className="mt-4 space-y-3 text-sm">
            <Button
              type="button"
              variant="outline"
              className="border-border"
              onClick={() => setSelectedId(null)}
            >
              Volver
            </Button>
            {detail.isLoading && <p className="text-silver">Cargando venta…</p>}
            {detail.isError && (
              <p className="text-destructive text-xs" role="alert">
                {detail.error instanceof Error ? detail.error.message : "No se pudo abrir la venta"}
              </p>
            )}
            {detail.data && (
              <>
                <p className="text-silver-light">
                  {fecha(detail.data.venta.created_at)} · {detail.data.venta.medio_pago} ·{" "}
                  {formatARS(detail.data.venta.total)}
                </p>
                <p className="text-silver">
                  {detail.data.venta.cliente?.razon_social ||
                    detail.data.venta.cliente?.nombre ||
                    "Consumidor final"}
                </p>
                <ul className="divide-y divide-border border border-border">
                  {detail.data.lineas.map((linea) => (
                    <li
                      key={`${linea.codigo}-${linea.descripcion}`}
                      className="flex justify-between gap-3 px-2 py-1.5"
                    >
                      <span>
                        {linea.cantidad} × {linea.descripcion}
                      </span>
                      <span className="tabular-nums">{formatARS(linea.total)}</span>
                    </li>
                  ))}
                </ul>
                {detail.data.fiscal && (
                  <p className="text-xs text-silver">
                    {detail.data.fiscal.cbte_tipo_label}
                    {detail.data.fiscal.comprobante
                      ? ` · ${detail.data.fiscal.comprobante}`
                      : ""} · {detail.data.fiscal.estado}
                    {detail.data.fiscal.cae ? ` · CAE ${detail.data.fiscal.cae}` : ""}
                  </p>
                )}
                {detail.data.pdf_disponible ? (
                  <FiscalPdfActions
                    ventaId={detail.data.venta.id}
                    emailSugerido={detail.data.venta.cliente?.email}
                    telefono={detail.data.venta.cliente?.telefono}
                  />
                ) : (
                  <p className="text-xs text-silver" role="status">
                    Esta venta no tiene una factura autorizada con CAE. No hay PDF para descargar ni
                    reenviar.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Lista({
  loading,
  error,
  ventas,
  onRetry,
  onOpen,
}: {
  loading: boolean;
  error: string | null;
  ventas: VentaResumen[];
  onRetry: () => void;
  onOpen: (id: number) => void;
}) {
  if (loading) return <p className="mt-6 text-sm text-silver">Cargando ventas…</p>;
  if (error) {
    return (
      <div className="mt-6 space-y-2">
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
        <Button type="button" variant="outline" onClick={onRetry}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (ventas.length === 0)
    return <p className="mt-6 text-sm text-silver">No hay ventas registradas.</p>;
  return (
    <ul className="mt-4 divide-y divide-border">
      {ventas.map((venta) => (
        <li key={venta.id}>
          <button
            type="button"
            className="w-full py-3 text-left hover:bg-midnight/40"
            onClick={() => onOpen(venta.id)}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">#{venta.id}</span>
              <span className="tabular-nums">{formatARS(venta.total)}</span>
            </div>
            <div className="text-xs text-silver">
              {fecha(venta.created_at)} · {venta.medio_pago}
              {venta.cliente ? ` · ${venta.cliente}` : ""}
            </div>
            <div className="text-xs text-silver">
              {venta.pdf_disponible
                ? "PDF disponible"
                : venta.fiscal_estado
                  ? `Fiscal: ${venta.fiscal_estado}`
                  : "Sin comprobante"}
              {venta.comprobante ? ` · ${venta.comprobante}` : ""}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
