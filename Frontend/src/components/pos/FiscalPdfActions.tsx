import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
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
  ApiError,
  crearEnlaceFactura,
  enviarFacturaEmail,
  fetchDistribucionFactura,
  fetchFacturaPdf,
} from "@/lib/api-client";

type Props = {
  ventaId: number;
  emailSugerido?: string | null;
  telefono?: string | null;
};

type Busy = "ver" | "descargar" | "email" | "whatsapp" | null;

export function FiscalPdfActions({ ventaId, emailSugerido, telefono }: Props) {
  const meta = useQuery({
    queryKey: ["factura-distribucion", ventaId],
    queryFn: () => fetchDistribucionFactura(ventaId),
  });
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState(emailSugerido ?? "");
  const sugerido = meta.data?.email_sugerido ?? emailSugerido ?? "";
  const tel = meta.data?.telefono ?? telefono ?? "";

  useEffect(() => {
    if (sugerido) setEmailTo((current) => current || sugerido);
  }, [sugerido]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function withPdf(
    action: Exclude<Busy, "email" | null>,
    run: (file: { blob: Blob; filename: string }) => Promise<void>,
  ) {
    setBusy(action);
    setError(null);
    try {
      const file = await fetchFacturaPdf(ventaId);
      await run(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo obtener el PDF");
    } finally {
      setBusy(null);
    }
  }

  async function ver() {
    await withPdf("ver", async ({ blob }) => {
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(blob));
    });
  }

  async function descargar() {
    await withPdf("descargar", async ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(`Descargada ${filename}`);
    });
  }

  async function whatsapp() {
    setBusy("whatsapp");
    setError(null);
    try {
      const { blob, filename } = await fetchFacturaPdf(ventaId);
      const file = new File([blob], filename, { type: "application/pdf" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename, text: "Factura Radio Colonia" });
          toast.success("Compartida");
          return;
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
        }
      }
      const link = await crearEnlaceFactura(ventaId);
      const text = `Factura ${filename}. El PDF se descarga desde este enlace, que vence: ${link.url}`;
      const digits = tel.replace(/\D/g, "");
      const href = digits
        ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
        : `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(href, "_blank", "noopener,noreferrer");
      toast.message(
        "Este navegador no adjunta el PDF en WhatsApp. Se abrió un mensaje con un enlace seguro.",
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "No se pudo compartir",
      );
    } finally {
      setBusy(null);
    }
  }

  async function enviarEmail() {
    setBusy("email");
    setError(null);
    try {
      const res = await enviarFacturaEmail(ventaId, { to: emailTo.trim() });
      toast.success(`Enviada a ${res.destino}`);
      setEmailOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el correo");
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy != null;
  const emailConfigurado = meta.data?.email_configurado ?? true;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-silver">
        El PDF se arma con la factura ya autorizada. No vuelve a emitirla.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-busy={busy === "ver"}
          onClick={() => void ver()}
        >
          {busy === "ver" ? "Abriendo…" : "Ver PDF"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-busy={busy === "descargar"}
          onClick={() => void descargar()}
        >
          {busy === "descargar" ? "Descargando…" : "Descargar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => setEmailOpen(true)}
        >
          Email
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-busy={busy === "whatsapp"}
          onClick={() => void whatsapp()}
        >
          {busy === "whatsapp" ? "Compartiendo…" : "WhatsApp"}
        </Button>
      </div>
      {error && (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <iframe
          title="Vista de la factura"
          src={preview}
          className="h-80 w-full border border-border bg-white"
        />
      )}

      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="bg-charcoal border-border text-silver-light sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar factura</DialogTitle>
            <DialogDescription className="text-silver">
              El PDF adjunto es el de la factura autorizada.
            </DialogDescription>
          </DialogHeader>
          {!emailConfigurado && (
            <p className="text-xs text-amber-200" role="status">
              Falta configurar el correo del servidor (INVOICE_SMTP_HOST e INVOICE_EMAIL_FROM).
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor={`email-factura-${ventaId}`}>Destinatario</Label>
            <Input
              id={`email-factura-${ventaId}`}
              type="email"
              autoComplete="email"
              value={emailTo}
              onChange={(event) => setEmailTo(event.target.value)}
              placeholder="cliente@correo.com"
            />
          </div>
          {error && emailOpen && (
            <p className="text-destructive text-xs" role="alert">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEmailOpen(false)}
              disabled={busy === "email"}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void enviarEmail()}
              disabled={disabled || !emailConfigurado || !emailTo.trim()}
              aria-busy={busy === "email"}
            >
              {busy === "email" ? "Enviando…" : "Enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
