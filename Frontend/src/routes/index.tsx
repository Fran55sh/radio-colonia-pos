import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Trash2, Wifi, WifiOff, ScanLine, Plus, RefreshCw } from "lucide-react";
import {
  checkApiConnection,
  createVenta,
  fetchProductos,
  syncOfflineVentas,
  type ProductoCaja,
} from "@/lib/api-client";
import {
  enqueueSale,
  generateClientSaleId,
  loadOfflineQueue,
  removeFromQueue,
} from "@/lib/offline-queue";

export const Route = createFileRoute("/")({
  component: POS,
  head: () => ({
    meta: [
      { title: "POS — Punto de Venta" },
      { name: "description", content: "High-performance Point of Sale frontend for fast retail checkout." },
    ],
  }),
});

type CartItem = ProductoCaja & { qty: number };

function formatCLP(n: number) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);
}

function POS() {
  const queryClient = useQueryClient();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [scan, setScan] = useState("");
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(new Date());
  const [toast, setToast] = useState<string | null>(null);
  const [pendingOffline, setPendingOffline] = useState(0);
  const [processing, setProcessing] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const offlineStreakRef = useRef(0);

  const { data: catalog = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["pos-productos"],
    queryFn: fetchProductos,
    staleTime: 30_000,
    retry: 1,
  });

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setPendingOffline(loadOfflineQueue().length);
  }, []);

  const checkConnection = useCallback(async () => {
    const status = await checkApiConnection();
    if (status.online) {
      offlineStreakRef.current = 0;
      setOnline(true);
    } else {
      offlineStreakRef.current += 1;
      if (offlineStreakRef.current >= 2) {
        setOnline(false);
      }
    }
    return status;
  }, []);

  useEffect(() => {
    void checkConnection();
    const interval = setInterval(() => void checkConnection(), 15_000);
    return () => clearInterval(interval);
  }, [checkConnection]);

  const syncOfflineQueue = useCallback(async () => {
    const queue = loadOfflineQueue();
    if (queue.length === 0) return;
    try {
      const result = await syncOfflineVentas(queue);
      const syncedIds = result.resultados.map((r) => r.client_sale_id);
      removeFromQueue(syncedIds);
      setPendingOffline(loadOfflineQueue().length);
      if (result.procesadas > 0) {
        flash(`${result.procesadas} venta(s) offline sincronizada(s)`);
        void queryClient.invalidateQueries({ queryKey: ["pos-productos"] });
      }
      if (result.errores.length > 0) {
        flash(`${result.errores.length} venta(s) con error al sincronizar`);
      }
    } catch {
      flash("No se pudo sincronizar la cola offline");
    }
  }, [queryClient]);

  useEffect(() => {
    if (online && pendingOffline > 0) {
      void syncOfflineQueue();
    }
  }, [online, pendingOffline, syncOfflineQueue]);

  const focusScan = useCallback(() => scanRef.current?.focus(), []);
  useEffect(() => { focusScan(); }, [focusScan]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const addByCode = useCallback(
    (raw: string) => {
      const code = raw.trim().toLowerCase();
      if (!code) return;
      const product = catalog.find((p) => p.codigo_interno === code);
      if (!product) {
        flash(`Código "${raw}" no encontrado`);
        return;
      }
      if (product.stock <= 0) {
        flash(`Sin stock: ${product.nombre}`);
        return;
      }
      setCart((prev) => {
        const existing = prev.find((i) => i.codigo_interno === product.codigo_interno);
        if (existing) {
          if (existing.qty >= product.stock) {
            flash(`Stock máximo alcanzado (${product.stock})`);
            return prev;
          }
          return prev.map((i) =>
            i.codigo_interno === product.codigo_interno ? { ...i, qty: i.qty + 1 } : i,
          );
        }
        return [...prev, { ...product, qty: 1 }];
      });
      setScan("");
    },
    [catalog, flash],
  );

  const handlePay = useCallback(
    async (method: string) => {
      if (cart.length === 0) {
        flash("Carrito vacío");
        return;
      }
      if (processing) return;
      setProcessing(true);

      const saleTotal = cart.reduce((s, i) => s + i.qty * i.precio_venta, 0);
      const lineas = cart.map((i) => ({
        codigo_interno: i.codigo_interno,
        cantidad: i.qty,
      }));
      const clientSaleId = generateClientSaleId();
      const payload = {
        client_sale_id: clientSaleId,
        medio_pago: method,
        lineas,
      };

      try {
        if (!online) {
          enqueueSale({ ...payload, sincronizada_offline: true, queued_at: new Date().toISOString() });
          setPendingOffline(loadOfflineQueue().length);
          flash(`Venta guardada offline: ${method} — ${formatCLP(saleTotal)}`);
          setCart([]);
          focusScan();
          return;
        }

        const result = await createVenta(payload);
        flash(`Venta #${result.venta_id}: ${method} — ${formatCLP(result.total)}`);
        setCart([]);
        void queryClient.invalidateQueries({ queryKey: ["pos-productos"] });
        focusScan();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error al registrar venta";
        if (msg.toLowerCase().includes("stock")) {
          flash(msg);
          void refetch();
        } else if (!online || msg.includes("fetch")) {
          enqueueSale({ ...payload, sincronizada_offline: true, queued_at: new Date().toISOString() });
          setPendingOffline(loadOfflineQueue().length);
          flash(`Venta en cola offline: ${method}`);
          setCart([]);
        } else {
          flash(msg);
        }
      } finally {
        setProcessing(false);
      }
    },
    [cart, online, processing, flash, focusScan, queryClient, refetch],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); focusScan(); }
      if (e.key === "F8") { e.preventDefault(); void handlePay("Efectivo"); }
      if (e.key === "F9") { e.preventDefault(); void handlePay("Débito/Crédito"); }
      if (e.key === "F10") { e.preventDefault(); void handlePay("Mercado Pago QR"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusScan, handlePay]);

  const updateQty = (code: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.codigo_interno !== code) return i;
          const product = catalog.find((p) => p.codigo_interno === code);
          const maxStock = product?.stock ?? i.qty;
          return { ...i, qty: Math.min(maxStock, Math.max(1, i.qty + delta)) };
        }),
    );
  };

  const removeItem = (code: string) =>
    setCart((prev) => prev.filter((i) => i.codigo_interno !== code));

  const total = useMemo(() => cart.reduce((s, i) => s + i.qty * i.precio_venta, 0), [cart]);
  const sortedCatalog = useMemo(
    () => [...catalog].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    [catalog],
  );
  const filtered = useMemo(() => {
    const q = scan.trim().toLowerCase();
    if (!q) return [];
    return sortedCatalog.filter(
      (p) => p.codigo_interno.toLowerCase().includes(q) || p.nombre.toLowerCase().includes(q),
    );
  }, [scan, sortedCatalog]);
  const itemCount = useMemo(() => cart.reduce((s, i) => s + i.qty, 0), [cart]);

  const toggleOnline = async () => {
    const status = await checkConnection();
    if (!status.online) {
      setOnline(false);
      flash("Sin conexión al servidor. Modo offline activo.");
      return;
    }
    setOnline(true);
    flash("Conexión restablecida.");
    void syncOfflineQueue();
  };

  return (
    <div className="min-h-screen flex flex-col bg-midnight text-foreground font-mono">
      <header className="h-14 shrink-0 border-b border-border bg-charcoal flex items-center px-5 gap-4">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-md bg-primary grid place-items-center text-primary-foreground font-bold">R</div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-silver-light">Radio Colonia POS</div>
            <div className="text-[11px] text-silver">Caja 01 · Omnicanal</div>
          </div>
        </div>

        <div className="flex-1" />

        {pendingOffline > 0 && (
          <span className="text-[11px] text-offline font-semibold">
            Cola offline: {pendingOffline}
          </span>
        )}

        <button
          onClick={() => void refetch()}
          className="p-1.5 rounded-md border border-border text-silver hover:text-silver-light"
          title="Actualizar catálogo"
        >
          <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </button>

        <button
          onClick={() => void toggleOnline()}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-semibold tracking-wide transition-colors ${
            online
              ? "border-online/40 bg-online/10 text-online hover:bg-online/20"
              : "border-offline/40 bg-offline/10 text-offline hover:bg-offline/20"
          }`}
          title="Estado de conexión API"
        >
          {online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
          {online ? "ONLINE" : "OFFLINE"}
          <span className={`size-1.5 rounded-full ${online ? "bg-online" : "bg-offline"} animate-pulse`} />
        </button>

        <div className="text-right leading-tight">
          <div className="text-sm text-silver-light tabular-nums">
            {now.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <div className="text-[11px] text-silver">
            {now.toLocaleDateString("es-CL", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
          </div>
        </div>
      </header>

      {isError && (
        <div className="px-5 py-2 bg-offline/10 text-offline text-xs border-b border-offline/30">
          No se pudo cargar el catálogo. Verificá que el backend esté en ejecución (puerto 3001).
        </div>
      )}

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[65%_35%] min-h-0">
        <section className="border-r border-border flex flex-col min-h-0">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-charcoal/60">
            <h2 className="text-xs font-bold uppercase tracking-widest text-silver">Venta en curso</h2>
            <div className="text-xs text-silver">
              {cart.length} ítems · {itemCount} unidades
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-midnight z-10">
                <tr className="text-left text-[11px] uppercase tracking-wider text-silver border-b border-border">
                  <th className="px-5 py-3 font-semibold w-32">Código</th>
                  <th className="px-3 py-3 font-semibold">Descripción</th>
                  <th className="px-3 py-3 font-semibold w-32 text-center">Cantidad</th>
                  <th className="px-3 py-3 font-semibold w-32 text-right">Precio</th>
                  <th className="px-3 py-3 font-semibold w-36 text-right">Total</th>
                  <th className="px-5 py-3 font-semibold w-16"></th>
                </tr>
              </thead>
              <tbody>
                {cart.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-24 text-center text-silver/60">
                      <ScanLine className="size-10 mx-auto mb-3 opacity-50" />
                      <div className="text-sm">Escanea o ingresa un código para comenzar</div>
                      <div className="text-xs mt-1">
                        Prueba: <span className="text-primary">utp5-020</span> ·{" "}
                        <span className="text-primary">con-rj45</span>
                      </div>
                    </td>
                  </tr>
                )}
                {cart.map((item) => (
                  <tr key={item.codigo_interno} className="border-b border-border/60 hover:bg-charcoal/50 transition-colors">
                    <td className="px-5 py-3 text-primary font-semibold uppercase">{item.codigo_interno}</td>
                    <td className="px-3 py-3 text-silver-light">{item.nombre}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => updateQty(item.codigo_interno, -1)} className="size-6 rounded border border-border text-silver hover:bg-charcoal hover:text-silver-light">−</button>
                        <span className="w-8 text-center text-silver-light tabular-nums">{item.qty}</span>
                        <button onClick={() => updateQty(item.codigo_interno, +1)} className="size-6 rounded border border-border text-silver hover:bg-charcoal hover:text-silver-light">+</button>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-silver tabular-nums">{formatCLP(item.precio_venta)}</td>
                    <td className="px-3 py-3 text-right text-silver-light font-semibold tabular-nums">
                      {formatCLP(item.precio_venta * item.qty)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => removeItem(item.codigo_interno)}
                        className="size-8 grid place-items-center rounded-md text-silver hover:bg-destructive/15 hover:text-destructive transition-colors"
                        aria-label="Eliminar"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="flex flex-col min-h-0 bg-charcoal/40">
          <div className="p-5 border-b border-border relative">
            <label className="text-[11px] uppercase tracking-widest text-silver font-bold">Escaneo</label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (filtered.length > 0 && scan.trim() && !catalog.find((p) => p.codigo_interno === scan.trim().toLowerCase())) {
                  addByCode(filtered[0].codigo_interno);
                } else {
                  addByCode(scan);
                }
              }}
              className="mt-2 relative"
            >
              <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-primary" />
              <input
                ref={scanRef}
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onBlur={() => setTimeout(focusScan, 0)}
                placeholder="Scan Barcode or Type Code [F2]"
                className="w-full h-14 pl-11 pr-4 rounded-lg bg-midnight border-2 border-primary text-silver-light placeholder:text-silver/50 text-base font-semibold tracking-wide outline-none focus:ring-2 focus:ring-primary/40 shadow-[0_0_0_3px_hsl(24_95%_53%/0.08)]"
                autoComplete="off"
                autoFocus
                disabled={isLoading}
              />
            </form>

            {scan.trim() && filtered.length > 0 && (
              <div className="absolute left-5 right-5 top-[105px] z-30 mt-1 rounded-lg bg-midnight border border-primary/60 shadow-2xl max-h-72 overflow-auto">
                {filtered.slice(0, 8).map((p) => (
                  <button
                    key={p.codigo_interno}
                    onMouseDown={(e) => { e.preventDefault(); addByCode(p.codigo_interno); }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-charcoal border-b border-border/40 last:border-0"
                  >
                    <span className="text-[10px] uppercase tracking-wider text-primary font-bold w-20 shrink-0">{p.codigo_interno}</span>
                    <span className="flex-1 text-xs text-silver-light truncate">{p.nombre}</span>
                    <span className="text-xs text-silver tabular-nums">{formatCLP(p.precio_venta)}</span>
                    <span className="text-[10px] text-silver/60">stk {p.stock}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-charcoal/60">
              <h3 className="text-[11px] uppercase tracking-widest text-silver font-bold">Lista de precios</h3>
              <span className="text-[11px] text-silver">
                {isLoading ? "Cargando…" : `${sortedCatalog.length} ítems · A–Z`}
              </span>
            </div>
            <div className="flex-1 overflow-auto divide-y divide-border/40">
              {sortedCatalog.map((p) => (
                <button
                  key={p.codigo_interno}
                  onClick={() => addByCode(p.codigo_interno)}
                  disabled={p.stock <= 0}
                  className="group w-full grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-5 py-2.5 text-left hover:bg-charcoal transition-colors disabled:opacity-40"
                >
                  <span className="text-[10px] uppercase tracking-wider text-primary font-bold w-20">{p.codigo_interno}</span>
                  <span className="text-xs text-silver-light truncate">{p.nombre}</span>
                  <span className="text-xs font-semibold text-silver-light tabular-nums">{formatCLP(p.precio_venta)}</span>
                  <Plus className="size-3.5 text-silver/40 group-hover:text-primary" />
                </button>
              ))}
            </div>
          </div>
        </aside>
      </main>

      <footer className="shrink-0 border-t-2 border-primary bg-charcoal">
        <div className="grid grid-cols-1 lg:grid-cols-[65%_35%]">
          <div className="px-6 py-5 flex items-center justify-between border-r border-border">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-silver font-bold">Total a pagar</div>
              <div className="text-[10px] text-silver/70 mt-0.5">{itemCount} unidades · IVA incluido</div>
            </div>
            <div className="text-right">
              <div className="text-5xl font-bold text-silver-light tabular-nums leading-none">
                <span className="text-primary mr-2">$</span>
                {new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(total)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-0">
            <PayBtn label="F8" name="Efectivo" onClick={() => void handlePay("Efectivo")} disabled={processing} />
            <PayBtn label="F9" name="Débito/Crédito" onClick={() => void handlePay("Débito/Crédito")} disabled={processing} />
            <PayBtn label="F10" name="Mercado Pago QR" onClick={() => void handlePay("Mercado Pago QR")} primary disabled={processing} />
          </div>
        </div>
      </footer>

      {toast && (
        <div className="fixed top-20 right-6 z-50 px-4 py-3 rounded-md bg-charcoal border border-primary text-silver-light text-sm shadow-xl max-w-sm">
          {toast}
        </div>
      )}
    </div>
  );
}

function PayBtn({
  label,
  name,
  onClick,
  primary,
  disabled,
}: {
  label: string;
  name: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group h-full py-5 px-4 border-l border-border flex flex-col items-center justify-center gap-1 transition-colors disabled:opacity-50 ${
        primary
          ? "bg-primary text-primary-foreground hover:bg-accent"
          : "bg-charcoal text-silver-light hover:bg-midnight"
      }`}
    >
      <span className={`text-[11px] font-bold tracking-widest ${primary ? "text-primary-foreground/80" : "text-primary"}`}>{label}</span>
      <span className="text-sm font-bold uppercase tracking-wide">{name}</span>
    </button>
  );
}
