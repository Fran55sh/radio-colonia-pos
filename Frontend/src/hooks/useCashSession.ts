import { useCallback, useEffect, useState } from "react";
import {
  fetchSesionActual,
  type CajaSesion,
} from "@/lib/api-client";
import {
  clearCachedCajaSesionId,
  DEFAULT_PUESTO,
  getCachedCajaSesionId,
  getCajaModo,
  setCachedCajaSesionId,
  type CajaModo,
} from "@/lib/caja-session";

type Options = {
  online: boolean;
  onFlash: (msg: string) => void;
};

export function useCashSession({ online, onFlash }: Options) {
  const [modo] = useState<CajaModo>(() => getCajaModo());
  const [sesionId, setSesionId] = useState<number | null>(() =>
    getCachedCajaSesionId(),
  );
  const [puesto, setPuesto] = useState(DEFAULT_PUESTO);
  const [loading, setLoading] = useState(true);
  const [waitingForOpen, setWaitingForOpen] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [movementDialog, setMovementDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);

  const applySesion = useCallback((sesion: CajaSesion | null) => {
    if (sesion) {
      setSesionId(sesion.id);
      setPuesto(sesion.puesto);
      setCachedCajaSesionId(sesion.id);
      setWaitingForOpen(false);
    } else {
      setSesionId(null);
      clearCachedCajaSesionId();
      setWaitingForOpen(true);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!online) {
      // Offline: keep cached id (D-OFF); don't clear.
      setLoading(false);
      if (getCachedCajaSesionId() == null) {
        setWaitingForOpen(true);
      }
      return;
    }
    setLoading(true);
    try {
      const actual = await fetchSesionActual(DEFAULT_PUESTO);
      if (actual) {
        applySesion(actual);
      } else {
        applySesion(null);
        if (modo === "principal") {
          setOpenDialog(true);
        }
      }
    } catch (err) {
      onFlash(
        err instanceof Error ? err.message : "No se pudo consultar la sesión de caja",
      );
    } finally {
      setLoading(false);
    }
  }, [online, modo, applySesion, onFlash]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleOpened = useCallback(
    (sesion: CajaSesion) => {
      applySesion(sesion);
      onFlash(`Caja abierta — sesión #${sesion.id}`);
    },
    [applySesion, onFlash],
  );

  const handleClosed = useCallback(
    (message: string) => {
      applySesion(null);
      onFlash(message);
    },
    [applySesion, onFlash],
  );

  const canSell = sesionId != null;
  const isPrincipal = modo === "principal";

  return {
    modo,
    isPrincipal,
    sesionId,
    puesto,
    loading,
    waitingForOpen,
    canSell,
    openDialog,
    setOpenDialog,
    movementDialog,
    setMovementDialog,
    closeDialog,
    setCloseDialog,
    handleOpened,
    handleClosed,
    refresh,
  };
}
