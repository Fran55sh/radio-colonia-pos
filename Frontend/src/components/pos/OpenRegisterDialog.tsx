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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  abrirSesionCaja,
  type CajaOpeningBalance,
  type CajaSesion,
} from "@/lib/api-client";
import { DEFAULT_PUESTO } from "@/lib/caja-session";

const METHODS = ["Efectivo", "Débito/Crédito", "Mercado Pago QR"] as const;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpened: (sesion: CajaSesion) => void;
};

export function OpenRegisterDialog({ open, onOpenChange, onOpened }: Props) {
  const [amounts, setAmounts] = useState<Record<string, string>>({
    Efectivo: "0",
    "Débito/Crédito": "0",
    "Mercado Pago QR": "0",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen() {
    setBusy(true);
    setError(null);
    try {
      const saldos: CajaOpeningBalance[] = METHODS.map((m) => ({
        payment_method: m,
        amount: Math.max(0, Number(amounts[m]?.replace(",", ".") || 0)),
      }));
      const sesion = await abrirSesionCaja({
        puesto: DEFAULT_PUESTO,
        saldos,
      });
      onOpened(sesion);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir la caja");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-charcoal border-border text-silver-light sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-silver-light">Abrir caja</DialogTitle>
          <DialogDescription className="text-silver">
            Fondo inicial desglosado por medio de pago — {DEFAULT_PUESTO}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          {METHODS.map((m) => (
            <div key={m} className="grid gap-1">
              <Label className="text-silver text-xs">{m}</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={amounts[m]}
                onChange={(e) =>
                  setAmounts((prev) => ({ ...prev, [m]: e.target.value }))
                }
                className="bg-charcoal-light border-border text-silver-light"
              />
            </div>
          ))}
          {error && <p className="text-destructive text-xs">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="border-border"
          >
            Cancelar
          </Button>
          <Button onClick={() => void handleOpen()} disabled={busy}>
            {busy ? "Abriendo…" : "Abrir caja"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
