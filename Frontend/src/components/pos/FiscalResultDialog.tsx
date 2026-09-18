import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { retryFiscal, type FiscalResult } from "@/lib/api-client";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fiscal: FiscalResult | null;
  ventaId: number;
  total: number;
  formatMoney: (n: number) => string;
  onFiscalUpdated?: (fiscal: FiscalResult) => void;
};

export function FiscalResultDialog({
  open,
  onOpenChange,
  fiscal,
  ventaId,
  total,
  formatMoney,
  onFiscalUpdated,
}: Props) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  if (!fiscal) return null;

  const ok = fiscal.estado === "emitido" && !!fiscal.cae;
  const canRetry = fiscal.estado === "error" || fiscal.estado === "pendiente";

  async function handleRetry() {
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await retryFiscal(ventaId);
      if (res.fiscal) {
        onFiscalUpdated?.(res.fiscal);
      }
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "No se pudo reintentar");
    } finally {
      setRetrying(false);
    }
  }

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
            <p className="text-silver text-xs">
              Emisión fiscal pendiente (offline o ARCA no disponible).
            </p>
          )}
          {fiscal.estado === "error" && fiscal.error_message && (
            <p className="text-destructive text-xs">{fiscal.error_message}</p>
          )}
          {retryError && <p className="text-destructive text-xs">{retryError}</p>}
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

        <DialogFooter className="gap-2 sm:gap-2">
          {canRetry && (
            <Button
              variant="outline"
              disabled={retrying}
              onClick={() => void handleRetry()}
            >
              {retrying ? "Reintentando…" : "Reintentar"}
            </Button>
          )}
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
