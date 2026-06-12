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
import type { Cliente, CreateClientePayload } from "@/lib/api-client";

const CONDICION_IVA_RI = 1;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: CreateClientePayload) => Promise<Cliente>;
  onCreated: (cliente: Cliente) => void;
};

export function CustomerFormDialog({ open, onOpenChange, onSubmit, onCreated }: Props) {
  const [nombre, setNombre] = useState("");
  const [documento, setDocumento] = useState("");
  const [docTipo, setDocTipo] = useState<"CUIT" | "DNI" | "CF">("CF");
  const [condicionIva, setCondicionIva] = useState<string>("5");
  const [razonSocial, setRazonSocial] = useState("");
  const [telefono, setTelefono] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setNombre("");
    setDocumento("");
    setDocTipo("CF");
    setCondicionIva("5");
    setRazonSocial("");
    setTelefono("");
    setError(null);
  };

  const handleSave = async () => {
    if (!nombre.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: CreateClientePayload = {
        nombre: nombre.trim(),
        documento: documento.trim() || undefined,
        documento_tipo_afip: docTipo,
        condicion_iva_receptor_id:
          docTipo === "CUIT" ? Number(condicionIva) : undefined,
        razon_social: razonSocial.trim() || undefined,
        telefono: telefono.trim() || undefined,
      };
      const cliente = await onSubmit(payload);
      onCreated(cliente);
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear cliente");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="bg-charcoal border-border text-silver-light sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-silver-light">Nuevo cliente</DialogTitle>
          <DialogDescription className="text-silver">
            Datos mínimos para facturación ARCA en caja.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label className="text-silver text-xs">Nombre / Razón social</Label>
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="bg-midnight border-border"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-silver text-xs">Tipo documento</Label>
            <Select value={docTipo} onValueChange={(v) => setDocTipo(v as "CUIT" | "DNI" | "CF")}>
              <SelectTrigger className="bg-midnight border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CF">Consumidor final</SelectItem>
                <SelectItem value="CUIT">CUIT</SelectItem>
                <SelectItem value="DNI">DNI</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {docTipo === "CUIT" && (
            <>
              <div className="grid gap-1.5">
                <Label className="text-silver text-xs">CUIT</Label>
                <Input
                  value={documento}
                  onChange={(e) => setDocumento(e.target.value)}
                  placeholder="20123456789"
                  className="bg-midnight border-border font-mono"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-silver text-xs">Condición IVA</Label>
                <Select value={condicionIva} onValueChange={setCondicionIva}>
                  <SelectTrigger className="bg-midnight border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={String(CONDICION_IVA_RI)}>
                      Responsable Inscripto (Factura A)
                    </SelectItem>
                    <SelectItem value="5">Consumidor final (Factura B)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-silver text-xs">Razón social (opcional)</Label>
                <Input
                  value={razonSocial}
                  onChange={(e) => setRazonSocial(e.target.value)}
                  className="bg-midnight border-border"
                />
              </div>
            </>
          )}
          {docTipo === "DNI" && (
            <div className="grid gap-1.5">
              <Label className="text-silver text-xs">DNI</Label>
              <Input
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                className="bg-midnight border-border font-mono"
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label className="text-silver text-xs">Teléfono (opcional)</Label>
            <Input
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              className="bg-midnight border-border"
            />
          </div>
          {error && <p className="text-destructive text-xs">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border">
            Cancelar
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Guardando…" : "Crear y seleccionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
