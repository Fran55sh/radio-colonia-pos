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
import {
  CONDICIONES_IVA_RECEPTOR,
  CONDICION_IVA_CF,
} from "@/lib/iva-condiciones";

type DocTipo = "CUIT" | "DNI" | "CF";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: CreateClientePayload) => Promise<Cliente>;
  onCreated: (cliente: Cliente) => void;
};

export function CustomerFormDialog({ open, onOpenChange, onSubmit, onCreated }: Props) {
  const [nombre, setNombre] = useState("");
  const [documento, setDocumento] = useState("");
  const [docTipo, setDocTipo] = useState<DocTipo>("CF");
  const [condicionIva, setCondicionIva] = useState<string>(String(CONDICION_IVA_CF));
  const [razonSocial, setRazonSocial] = useState("");
  const [telefono, setTelefono] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setNombre("");
    setDocumento("");
    setDocTipo("CF");
    setCondicionIva(String(CONDICION_IVA_CF));
    setRazonSocial("");
    setTelefono("");
    setError(null);
  };

  function handleDocTipoChange(value: DocTipo) {
    setDocTipo(value);
    if (value === "CF") {
      setCondicionIva(String(CONDICION_IVA_CF));
      setDocumento("");
    }
  }

  const handleSave = async () => {
    if (!nombre.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    if (docTipo === "CUIT" && !documento.replace(/\D/g, "").match(/^\d{11}$/)) {
      setError("El CUIT debe tener 11 dígitos");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: CreateClientePayload = {
        nombre: nombre.trim(),
        documento: documento.trim() || undefined,
        documento_tipo_afip: docTipo,
        condicion_iva_receptor_id: Number(condicionIva),
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
            <Select value={docTipo} onValueChange={(v) => handleDocTipoChange(v as DocTipo)}>
              <SelectTrigger className="bg-midnight border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CF">Consumidor final (sin documento)</SelectItem>
                <SelectItem value="CUIT">CUIT</SelectItem>
                <SelectItem value="DNI">DNI</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-silver text-xs">Condición IVA</Label>
            <Select value={condicionIva} onValueChange={setCondicionIva}>
              <SelectTrigger className="bg-midnight border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDICIONES_IVA_RECEPTOR.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.label}
                  </SelectItem>
                ))}
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
