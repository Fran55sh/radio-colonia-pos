type Props = {
  sesionId: number | null;
  puesto: string;
  modo: "principal" | "satelite";
  waitingForOpen: boolean;
  onAbrir?: () => void;
  onRetiro?: () => void;
  onCerrar?: () => void;
};

export function CashSessionBanner({
  sesionId,
  puesto,
  modo,
  waitingForOpen,
  onAbrir,
  onRetiro,
  onCerrar,
}: Props) {
  const isPrincipal = modo === "principal";

  if (waitingForOpen) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-amber-400/90">
          {isPrincipal
            ? "Caja sin abrir"
            : "La caja no está abierta en el puesto"}
        </span>
        {isPrincipal && onAbrir && (
          <button
            type="button"
            onClick={onAbrir}
            className="rounded bg-primary/20 px-2 py-0.5 text-primary hover:bg-primary/30"
          >
            Abrir caja
          </button>
        )}
      </div>
    );
  }

  if (sesionId == null) {
    return (
      <div className="text-[11px] text-silver">{puesto} · sin sesión</div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <span className="text-silver">
        Sesión #{sesionId} abierta · {puesto}
        {modo === "satelite" ? " · satélite" : ""}
      </span>
      {isPrincipal && (
        <>
          {onRetiro && (
            <button
              type="button"
              onClick={onRetiro}
              className="rounded bg-charcoal-light px-2 py-0.5 text-silver-light hover:bg-border"
            >
              Retiro
            </button>
          )}
          {onCerrar && (
            <button
              type="button"
              onClick={onCerrar}
              className="rounded bg-charcoal-light px-2 py-0.5 text-silver-light hover:bg-border"
            >
              Cerrar
            </button>
          )}
        </>
      )}
    </div>
  );
}
