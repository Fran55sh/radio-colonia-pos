import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fetchProductos, type ProductoCaja } from "@/lib/api-client";
import { formatARS } from "@/lib/format-money";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (product: ProductoCaja) => void;
  hint?: string;
};

export function ProductPickerDialog({ open, onOpenChange, onSelect, hint }: Props) {
  const [q, setQ] = useState("");
  const { data: catalog = [], isLoading } = useQuery({
    queryKey: ["pos-productos"],
    queryFn: fetchProductos,
    staleTime: 30_000,
    enabled: open,
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return catalog.slice(0, 40);
    return catalog
      .filter(
        (p) =>
          p.codigo_interno.toLowerCase().includes(term) ||
          p.nombre.toLowerCase().includes(term),
      )
      .slice(0, 40);
  }, [catalog, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-charcoal border-border text-silver-light sm:max-w-lg max-h-[90dvh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Seleccionar producto</DialogTitle>
          <DialogDescription className="text-silver">
            {hint ? `Detectado: ${hint}` : "Buscá por código o nombre en el catálogo"}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-primary" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar producto…"
            className="pl-9 bg-midnight border-border"
            autoFocus
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border/40 max-h-72">
          {isLoading && <p className="p-3 text-sm text-silver">Cargando…</p>}
          {!isLoading && filtered.length === 0 && (
            <p className="p-3 text-sm text-silver">Sin resultados</p>
          )}
          {filtered.map((p) => (
            <button
              key={p.codigo_interno}
              type="button"
              className="w-full text-left px-3 py-3 hover:bg-midnight transition-colors"
              onClick={() => {
                onSelect(p);
                onOpenChange(false);
                setQ("");
              }}
            >
              <div className="text-[10px] uppercase text-primary font-bold">{p.codigo_interno}</div>
              <div className="text-sm text-silver-light truncate">{p.nombre}</div>
              <div className="text-xs text-silver tabular-nums">
                {formatARS(p.precio_venta)} · stk {p.stock}
              </div>
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border">
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
