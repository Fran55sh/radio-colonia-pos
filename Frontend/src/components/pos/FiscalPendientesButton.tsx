import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFiscalPendientes, type FiscalResult } from "@/lib/api-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  online: boolean;
  onOpen: (ventaId: number, fiscal: FiscalResult) => void;
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente de emitir",
  enviando: "Enviando a ARCA",
  desconocido: "Sin confirmar con ARCA",
  rechazado: "Rechazada por ARCA",
  error: "Error al emitir",
};

function accion(item: FiscalResult): string {
  if (item.requiere_conciliacion) return "Verificar";
  if (item.estado === "error" || item.estado === "rechazado") return "Reintentar";
  if (item.estado === "pendiente") return "Emitir";
  return "Abrir";
}

export function FiscalPendientesButton({ online, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data, isFetching, isError } = useQuery({
    queryKey: ["fiscal-pendientes"],
    queryFn: fetchFiscalPendientes,
    enabled: online,
    refetchInterval: 30_000,
  });
  const items = data?.pendientes ?? [];
  if (!online || (items.length === 0 && !open)) return null;

  return (
    <>
      <button
        type="button"
        className="px-2 py-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 text-xs font-semibold text-amber-100 hover:bg-amber-500/20"
        onClick={() => {
          void queryClient.invalidateQueries({ queryKey: ["fiscal-pendientes"] });
          setOpen(true);
        }}
      >
        Sin factura {items.length}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-charcoal border-border text-silver-light sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-silver-light">Ventas sin factura de ARCA</DialogTitle>
            <DialogDescription className="text-silver">
              La venta y el cobro ya quedaron registrados. Falta el comprobante fiscal.
              {isFetching ? " Actualizando…" : ""}
            </DialogDescription>
          </DialogHeader>
          {isError && (
            <p className="text-xs text-destructive">No se pudo cargar la lista.</p>
          )}
          {items.length === 0 ? (
            <p className="text-sm text-silver">No hay comprobantes pendientes.</p>
          ) : (
            <ul className="max-h-80 overflow-auto divide-y divide-border">
              {items.map((item) => (
                <li key={item.venta_id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-semibold">Venta #{item.venta_id}</div>
                    <div className="text-xs text-amber-200">
                      {ESTADO_LABEL[item.estado] ?? item.estado}
                    </div>
                    {item.error_message && (
                      <p className="text-xs text-silver mt-1 break-words">{item.error_message}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded border border-border px-2 py-1 text-xs text-primary"
                    onClick={() => {
                      setOpen(false);
                      onOpen(item.venta_id, item);
                    }}
                  >
                    {accion(item)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
