import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FiscalResult } from "@/lib/api-client";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fiscal: FiscalResult | null;
  ventaId: number;
  total: number;
  formatMoney: (n: number) => string;
};

export function FiscalResultDialog({
  open,
  onOpenChange,
  fiscal,
  ventaId,
  total,
  formatMoney,
}: Props) {
  if (!fiscal) return null;

  const ok = fiscal.estado === "emitido" && !!fiscal.cae;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-charcoal border-border text-silver-light sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-silver-light">
            {ok ? "Comprobante autorizado" : "Resultado fiscal"}
          </DialogTitle>
          <DialogDescription className="text-silver">
            Venta #{ventaId} — {formatMoney(total)}
            {fiscal.ambiente === "dev" && (
              <span className="block mt-1 text-amber-400/90 text-xs">
                Homologación ARCA — sin validez fiscal
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-2 text-sm font-mono">
          <Row label="Tipo" value={fiscal.cbte_tipo_label} />
          {fiscal.comprobante && <Row label="Número" value={fiscal.comprobante} />}
          {fiscal.cae && <Row label="CAE" value={fiscal.cae} copyable />}
          {fiscal.cae_vencimiento && (
            <Row label="Vence" value={fiscal.cae_vencimiento} />
          )}
          {fiscal.estado === "pendiente" && (
            <p className="text-silver text-xs">Emisión fiscal pendiente (offline o ARCA no disponible).</p>
          )}
          {fiscal.estado === "error" && fiscal.error_message && (
            <p className="text-destructive text-xs">{fiscal.error_message}</p>
          )}
          {fiscal.qr_url && (
            <a
              href={fiscal.qr_url}
              target="_blank"
              rel="noreferrer"
              className="text-primary text-xs hover:underline break-all"
            >
              Ver QR AFIP
            </a>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  copyable,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4 items-start">
      <span className="text-silver text-xs uppercase tracking-wide shrink-0">{label}</span>
      <span
        className="text-silver-light text-right break-all"
        onClick={
          copyable
            ? () => void navigator.clipboard?.writeText(value)
            : undefined
        }
        title={copyable ? "Copiar" : undefined}
      >
        {value}
      </span>
    </div>
  );
}
