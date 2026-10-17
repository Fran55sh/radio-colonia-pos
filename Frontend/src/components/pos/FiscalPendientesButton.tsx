import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchFiscalPendientes, type FiscalResult } from "@/lib/api-client";

type Props = {
  online: boolean;
  onOpen: (ventaId: number, fiscal: FiscalResult) => void;
};

export function FiscalPendientesButton({ online, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["fiscal-pendientes"],
    queryFn: fetchFiscalPendientes,
    enabled: online,
    refetchInterval: 30_000,
  });
  const items = data?.pendientes ?? [];
  if (!online) return null;

  return (
    <div className="relative">
      <button
        type="button"
        className="px-2 py-1.5 rounded-md border border-border text-xs text-silver hover:text-silver-light"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Fiscal {items.length}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-40 w-72 rounded-md border border-border bg-charcoal p-2 shadow-xl">
          {items.length === 0 ? (
            <p className="text-xs text-silver px-2 py-3">No hay comprobantes pendientes</p>
          ) : (
            <ul className="max-h-64 overflow-auto">
              {items.map((item) => (
                <li key={item.venta_id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                  <span>
                    Venta #{item.venta_id} · {item.estado}
                  </span>
                  <button
                    type="button"
                    className="text-primary"
                    onClick={() => {
                      setOpen(false);
                      onOpen(item.venta_id, item);
                    }}
                  >
                    {item.requiere_conciliacion ? "Verificar" : "Abrir"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
