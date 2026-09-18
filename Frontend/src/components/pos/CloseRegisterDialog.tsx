import { useEffect, useState } from "react";
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
  cerrarSesionCaja,
  fetchCajaResumen,
  type CajaResumen,
} from "@/lib/api-client";
import { formatARS } from "@/lib/format-money";
import { loadOfflineQueue } from "@/lib/offline-queue";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sesionId: number;
  onClosed: (message: string) => void;
};

export function CloseRegisterDialog({
  open,
  onOpenChange,
  sesionId,
  onClosed,
}: Props) {
  const [resumen, setResumen] = useState<CajaResumen | null>(null);
  const [counted, setCounted] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [observations, setObservations] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOffline, setPendingOffline] = useState(0);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCounted("");
    setAdminPin("");
    setObservations("");
    setPendingOffline(loadOfflineQueue().length);
    void fetchCajaResumen(sesionId)
      .then(setResumen)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Error al cargar resumen"),
      );
  }, [open, sesionId]);

  const expected = resumen?.expected_cash ?? 0;
  const countedNum = Number(counted.replace(",", "."));
  const diff =
    Number.isFinite(countedNum) && counted !== ""
      ? Math.round((countedNum - expected) * 100) / 100
      : null;
  const needsPin = diff != null && diff !== 0;

  async function handleClose() {
    if (loadOfflineQueue().length > 0) {
      setError(
        "Hay ventas offline pendientes en este dispositivo. Sincronizá antes de cerrar (y en los demás equipos del puesto).",
      );
      setPendingOffline(loadOfflineQueue().length);
      return;
    }
    if (!Number.isFinite(countedNum) || countedNum < 0) {
      setError("Ingresá el efectivo contado");
      return;
    }
    if (needsPin && adminPin.length < 4) {
      setError("Diferencia requiere PIN admin");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await cerrarSesionCaja(sesionId, {
        counted_cash: countedNum,
        observations: observations.trim() || undefined,
        admin_pin: needsPin ? adminPin : undefined,
      });
      const d = result.diferencia.difference;
      onClosed(
        d === 0
          ? `Caja cerrada — arqueo OK (${formatARS(countedNum)})`
          : `Caja cerrada — diferencia ${formatARS(d)}`,
      );
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cerrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-charcoal border-border text-silver-light sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-silver-light">Cerrar caja</DialogTitle>
          <DialogDescription className="text-silver">
            Arqueo de efectivo — sesión #{sesionId}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          {pendingOffline > 0 && (
            <p className="text-amber-400 text-xs rounded border border-amber-500/40 bg-amber-500/10 p-2">
              {pendingOffline} venta(s) offline pendientes en este dispositivo.
              Sincronizá antes de cerrar.
            </p>
          )}

          <div className="text-sm font-mono text-silver-light">
            Efectivo esperado:{" "}
            <span className="text-primary">{formatARS(expected)}</span>
          </div>

          <div className="grid gap-1">
            <Label className="text-silver text-xs">Efectivo contado</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              className="bg-charcoal-light border-border text-silver-light"
              disabled={pendingOffline > 0}
            />
          </div>

          {diff != null && (
            <div
              className={`text-sm font-mono ${
                diff === 0 ? "text-emerald-400" : "text-amber-400"
              }`}
            >
              Diferencia: {formatARS(diff)}
            </div>
          )}

          {needsPin && (
            <div className="grid gap-1">
              <Label className="text-silver text-xs">PIN admin</Label>
              <Input
                type="password"
                value={adminPin}
                onChange={(e) => setAdminPin(e.target.value)}
                className="bg-charcoal-light border-border text-silver-light"
                autoComplete="off"
              />
            </div>
          )}

          <div className="grid gap-1">
            <Label className="text-silver text-xs">Observaciones</Label>
            <Input
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              className="bg-charcoal-light border-border text-silver-light"
            />
          </div>

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
          <Button
            onClick={() => void handleClose()}
            disabled={busy || pendingOffline > 0}
          >
            {busy ? "Cerrando…" : "Cerrar caja"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
