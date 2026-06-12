import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { User, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Cliente } from "@/lib/api-client";
import { fetchClientes } from "@/lib/api-client";
import { CustomerFormDialog } from "./CustomerFormDialog";
import type { CreateClientePayload } from "@/lib/api-client";

const CONDICION_IVA_RI = 1;

function resolveComprobanteLabel(cliente: Cliente | null): string {
  if (!cliente) return "Factura B — Consumidor final";
  const cuit = cliente.documento?.replace(/\D/g, "");
  if (cuit?.length === 11 && cliente.condicion_iva_receptor_id === CONDICION_IVA_RI) {
    return "Factura A";
  }
  return "Factura B";
}

type Props = {
  selected: Cliente | null;
  onSelect: (cliente: Cliente | null) => void;
  onCreate: (payload: CreateClientePayload) => Promise<Cliente>;
};

export function CustomerSelector({ selected, onSelect, onCreate }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ["pos-clientes", search],
    queryFn: () => fetchClientes(search || undefined),
    staleTime: 30_000,
  });

  const comprobanteLabel = useMemo(() => resolveComprobanteLabel(selected), [selected]);

  const displayName = selected
    ? selected.razon_social || selected.nombre
    : "Consumidor final";

  return (
    <div className="flex items-center gap-2 min-w-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="h-8 max-w-[220px] border-border bg-midnight text-silver-light text-xs gap-1.5 truncate"
            title="Seleccionar cliente (F3)"
          >
            <User className="size-3.5 shrink-0 text-primary" />
            <span className="truncate">{displayName}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0 bg-midnight border-border" align="end">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Buscar por nombre o documento…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>
                {isLoading ? "Cargando…" : "Sin resultados"}
              </CommandEmpty>
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    onSelect(null);
                    setOpen(false);
                  }}
                >
                  Consumidor final
                </CommandItem>
                {clientes.map((c) => (
                  <CommandItem
                    key={c.id}
                    onSelect={() => {
                      onSelect(c);
                      setOpen(false);
                    }}
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="truncate font-medium">{c.nombre}</span>
                      {c.documento && (
                        <span className="text-[10px] text-silver truncate">{c.documento}</span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-silver hover:text-primary"
        title="Nuevo cliente"
        onClick={() => setCreateOpen(true)}
      >
        <UserPlus className="size-4" />
      </Button>

      {selected && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-silver hover:text-destructive"
          title="Quitar cliente"
          onClick={() => onSelect(null)}
        >
          <X className="size-4" />
        </Button>
      )}

      <span className="hidden lg:inline text-[10px] text-silver/80 uppercase tracking-wide truncate">
        {comprobanteLabel}
      </span>

      <CustomerFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={onCreate}
        onCreated={(c) => {
          void queryClient.invalidateQueries({ queryKey: ["pos-clientes"] });
          onSelect(c);
        }}
      />
    </div>
  );
}
