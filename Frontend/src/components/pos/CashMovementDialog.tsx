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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { crearMovimientoCaja } from "@/lib/api-client";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sesionId: number;
  onDone: (message: string) => void;
};

export function CashMovementDialog({
  open,
  onOpenChange,
  sesionId,
  onDone,
}: Props) {
  const [tipo, setTipo] = useState<"ingreso_manual" | "retiro" | "gasto">(
    "retiro",
  );
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Efectivo");
  const [description, setDescription] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const value = Number(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      setError("Monto inválido");
      return;
    }
    if (tipo === "retiro" && adminPin.length < 4) {
      setError("Retiro requiere PIN admin");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await crearMovimientoCaja({
        sesion_id: sesionId,
        tipo,
        amount: value,
        payment_method: paymentMethod,
        description: description.trim() || undefined,
        admin_pin: tipo === "retiro" ? adminPin : undefined,
      });
      const msg = result.warning
        ? `${tipo}: $${value} — ${result.warning}`
        : `${tipo}: $${value} registrado`;
      onDone(msg);
      onOpenChange(false);
      setAmount("");
      setAdminPin("");
      setDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-charcoal border-border text-silver-light sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-silver-light">Movimiento de caja</DialogTitle>
          <DialogDescription className="text-silver">
            Sesión #{sesionId} — ingreso, retiro o gasto
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid gap-1">
            <Label className="text-silver text-xs">Tipo</Label>
            <Select
              value={tipo}
              onValueChange={(v) =>
                setTipo(v as "ingreso_manual" | "retiro" | "gasto")
              }
            >
              <SelectTrigger className="bg-charcoal-light border-border text-silver-light">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="retiro">Retiro</SelectItem>
                <SelectItem value="ingreso_manual">Ingreso</SelectItem>
                <SelectItem value="gasto">Gasto</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <Label className="text-silver text-xs">Monto</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="bg-charcoal-light border-border text-silver-light"
            />
          </div>

          <div className="grid gap-1">
            <Label className="text-silver text-xs">Medio</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger className="bg-charcoal-light border-border text-silver-light">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Efectivo">Efectivo</SelectItem>
                <SelectItem value="Débito/Crédito">Débito/Crédito</SelectItem>
                <SelectItem value="Mercado Pago QR">Mercado Pago QR</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <Label className="text-silver text-xs">Descripción</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="bg-charcoal-light border-border text-silver-light"
            />
          </div>

          {tipo === "retiro" && (
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
          <Button onClick={() => void handleSubmit()} disabled={busy}>
            {busy ? "Guardando…" : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
