import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { LogOut, Trash2, Wifi, WifiOff, ScanLine, Plus, RefreshCw, Menu, ChevronLeft, Package } from "lucide-react";
import { CustomerSelector } from "@/components/pos/CustomerSelector";
import { FiscalResultDialog } from "@/components/pos/FiscalResultDialog";
import { PosClock } from "@/components/pos/PosClock";
import {
  checkApiConnection,
  createCliente,
  createVenta,
  fetchAuthConfig,
  fetchProductos,
  syncOfflineVentas,
  type Cliente,
  type FiscalResult,
  type ProductoCaja,
} from "@/lib/api-client";
import {
  clearToken,
  getAuthRequired,
  isAuthenticated,
  setAuthRequired,
} from "@/lib/auth-session";
import { formatARS } from "@/lib/format-money";
import { resolveUnitPrice, priceRange } from "@/lib/quantity-pricing";
import {
  enqueueSale,
  generateClientSaleId,
  loadOfflineQueue,
  removeFromQueue,
} from "@/lib/offline-queue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;

    let authRequired = getAuthRequired();
    if (authRequired === null) {
      try {
        const cfg = await fetchAuthConfig();
        setAuthRequired(cfg.auth_required);
        authRequired = cfg.auth_required;
      } catch {
        if (!isAuthenticated()) {
          throw redirect({ to: "/login" });
        }
        return;
      }
    }

    if (authRequired && !isAuthenticated()) {
      throw redirect({ to: "/login" });
    }
  },
  component: POS,
  head: () => ({
    meta: [
      { title: "Radio Colonia — Caja" },
      { name: "description", content: "Punto de venta Radio Colonia" },
    ],
  }),
});

type CartItem = ProductoCaja & { qty: number; base_precio_venta: number };
type MobileStep = "precios" | "cobro";

function isCoarsePointer(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

function findCatalogProduct(catalog: ProductoCaja[], sku: string): ProductoCaja | undefined {
  const key = sku.trim().toLowerCase();
  return catalog.find((p) => p.codigo_interno.toLowerCase() === key);
}

function formatCatalogPrice(p: ProductoCaja, formatMoney: (n: number) => string): string {
  const tiers = p.price_tiers ?? [];
  if (tiers.length === 0) return formatMoney(p.precio_venta);
  const { min, max } = priceRange(p.precio_venta, tiers);
  if (Math.abs(min - max) < 0.009) return formatMoney(max);
  return `${formatMoney(min)} – ${formatMoney(max)}`;
}

function POS() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [scan, setScan] = useState("");
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingOffline, setPendingOffline] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [pendingProduct, setPendingProduct] = useState<ProductoCaja | null>(null);
  const [qtyInput, setQtyInput] = useState("1");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null);
  const [fiscalDialogOpen, setFiscalDialogOpen] = useState(false);
  const [lastFiscal, setLastFiscal] = useState<FiscalResult | null>(null);
  const [lastVentaId, setLastVentaId] = useState(0);
  const [lastSaleTotal, setLastSaleTotal] = useState(0);
  const [mobileStep, setMobileStep] = useState<MobileStep>("precios");
  const [menuOpen, setMenuOpen] = useState(false);
  const [isLg, setIsLg] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : true,
  );
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const searchResultRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const offlineStreakRef = useRef(0);

  const { data: catalog = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["pos-productos"],
    queryFn: fetchProductos,
    staleTime: 30_000,
    retry: 1,
  });

  // Recalcular carrito cuando el catálogo trae tramos/precios actualizados.
  useEffect(() => {
    if (catalog.length === 0) return;
    setCart((prev) => {
      if (prev.length === 0) return prev;
      let changed = false;
      const next = prev.map((item) => {
        const product = findCatalogProduct(catalog, item.codigo_interno);
        if (!product) return item;
        const base = product.precio_venta;
        const tiers = product.price_tiers ?? [];
        const resolved = resolveUnitPrice(base, tiers, item.qty);
        if (
          item.base_precio_venta === base &&
          item.precio_venta === resolved &&
          JSON.stringify(item.price_tiers ?? []) === JSON.stringify(tiers)
        ) {
          return item;
        }
        changed = true;
        return {
          ...item,
          nombre: product.nombre,
          stock: product.stock,
          alicuota_iva: product.alicuota_iva,
          base_precio_venta: base,
          price_tiers: tiers,
          precio_venta: resolved,
        };
      });
      return changed ? next : prev;
    });
  }, [catalog]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsLg(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
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

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

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
  }, [queryClient, flash]);

  useEffect(() => {
    if (online && pendingOffline > 0) {
      void syncOfflineQueue();
    }
  }, [online, pendingOffline, syncOfflineQueue]);

  const focusScan = useCallback(() => {
    if (isCoarsePointer()) return;
    scanRef.current?.focus();
  }, []);

  useEffect(() => {
    focusScan();
  }, [focusScan]);

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
  const searchResults = useMemo(() => filtered.slice(0, 8), [filtered]);

  const pendingQty = Math.max(1, parseInt(qtyInput, 10) || 1);
  const pendingUnitPrice = useMemo(() => {
    if (!pendingProduct) return 0;
    return resolveUnitPrice(
      pendingProduct.precio_venta,
      pendingProduct.price_tiers ?? [],
      pendingQty,
    );
  }, [pendingProduct, pendingQty]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [scan]);

  useEffect(() => {
    searchResultRefs.current[highlightedIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, searchResults]);

  const addToCart = useCallback(
    (product: ProductoCaja, qty: number) => {
      const live = findCatalogProduct(catalog, product.codigo_interno) ?? product;
      if (qty <= 0) {
        flash("La cantidad debe ser mayor a 0");
        return;
      }
      if (live.stock <= 0) {
        flash(`Sin stock: ${live.nombre}`);
        return;
      }
      if (qty > live.stock) {
        flash(`Stock insuficiente (disponible: ${live.stock})`);
        return;
      }

      const tiers = live.price_tiers ?? [];
      const base = live.precio_venta;

      setCart((prev) => {
        const existing = prev.find(
          (i) => i.codigo_interno.toLowerCase() === live.codigo_interno.toLowerCase(),
        );
        if (existing) {
          const nextQty = existing.qty + qty;
          if (nextQty > live.stock) {
            flash(`Stock máximo alcanzado (${live.stock})`);
            return prev;
          }
          return prev.map((i) =>
            i.codigo_interno.toLowerCase() === live.codigo_interno.toLowerCase()
              ? {
                  ...i,
                  qty: nextQty,
                  price_tiers: tiers,
                  base_precio_venta: existing.base_precio_venta ?? base,
                  precio_venta: resolveUnitPrice(
                    existing.base_precio_venta ?? base,
                    tiers,
                    nextQty,
                  ),
                }
              : i,
          );
        }
        return [
          ...prev,
          {
            ...live,
            qty,
            price_tiers: tiers,
            base_precio_venta: base,
            precio_venta: resolveUnitPrice(base, tiers, qty),
          },
        ];
      });
    },
    [catalog, flash],
  );

  const promptAddProduct = useCallback((product: ProductoCaja) => {
    setPendingProduct(product);
    setQtyInput("1");
  }, []);

  const closeQtyDialog = useCallback(() => {
    setPendingProduct(null);
    setQtyInput("1");
    setTimeout(focusScan, 0);
  }, [focusScan]);

  const confirmAddProduct = useCallback(() => {
    if (!pendingProduct) return;
    const qty = parseInt(qtyInput, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      flash("Ingresá una cantidad válida");
      return;
    }
    addToCart(pendingProduct, qty);
    setScan("");
    closeQtyDialog();
  }, [pendingProduct, qtyInput, addToCart, flash, closeQtyDialog]);

  useEffect(() => {
    if (pendingProduct) {
      const t = setTimeout(() => qtyRef.current?.select(), 50);
      return () => clearTimeout(t);
    }
  }, [pendingProduct]);

  const selectSearchResult = useCallback(
    (product: ProductoCaja) => {
      if (product.stock <= 0) {
        flash(`Sin stock: ${product.nombre}`);
        return;
      }
      promptAddProduct(product);
    },
    [flash, promptAddProduct],
  );

  const submitScan = useCallback(() => {
    const q = scan.trim().toLowerCase();
    if (!q) return;
    if (searchResults.length > 0) {
      selectSearchResult(searchResults[highlightedIndex] ?? searchResults[0]);
      return;
    }
    const exact = catalog.find((p) => p.codigo_interno.toLowerCase() === q);
    if (exact) {
      selectSearchResult(exact);
      return;
    }
    flash(`Código "${scan}" no encontrado`);
  }, [scan, catalog, searchResults, highlightedIndex, flash, selectSearchResult]);

  const handleScanKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (searchResults.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((i) => Math.min(i + 1, searchResults.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        selectSearchResult(searchResults[highlightedIndex] ?? searchResults[0]);
      }
    },
    [searchResults, highlightedIndex, selectSearchResult],
  );

  const resetAfterSale = useCallback(() => {
    setCart([]);
    setSelectedCliente(null);
    setMobileStep("precios");
    focusScan();
  }, [focusScan]);

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
        precio_unitario: i.precio_venta,
      }));
      const clientSaleId = generateClientSaleId();
      const payload = {
        client_sale_id: clientSaleId,
        cliente_id: selectedCliente?.id,
        medio_pago: method,
        lineas,
      };

      const warnOfflineStock = () => {
        for (const item of cart) {
          const product = catalog.find(
            (p) => p.codigo_interno.toLowerCase() === item.codigo_interno.toLowerCase(),
          );
          const available = product?.stock;
          if (available != null && item.qty > available) {
            flash(
              `Atención: ${item.codigo_interno} supera stock disponible (${available}). Venta guardada offline.`,
            );
          }
        }
      };

      const patchCatalogStock = () => {
        queryClient.setQueryData<ProductoCaja[]>(["pos-productos"], (prev) => {
          if (!prev) return prev;
          const qtyBySku = new Map(
            lineas.map((l) => [l.codigo_interno.toLowerCase(), l.cantidad]),
          );
          return prev.map((p) => {
            const sold = qtyBySku.get(p.codigo_interno.toLowerCase());
            if (!sold) return p;
            return { ...p, stock: Math.max(0, p.stock - sold) };
          });
        });
      };

      try {
        if (!online) {
          warnOfflineStock();
          enqueueSale({ ...payload, sincronizada_offline: true, queued_at: new Date().toISOString() });
          setPendingOffline(loadOfflineQueue().length);
          flash(`Venta guardada offline: ${method} — ${formatARS(saleTotal)}`);
          resetAfterSale();
          return;
        }

        const result = await createVenta(payload);
        flash(`Venta #${result.venta_id}: ${method} — ${formatARS(result.total)}`);
        if (result.fiscal) {
          setLastFiscal(result.fiscal);
          setLastVentaId(result.venta_id);
          setLastSaleTotal(result.total);
          setFiscalDialogOpen(true);
        }
        patchCatalogStock();
        resetAfterSale();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error al registrar venta";
        if (msg.toLowerCase().includes("stock")) {
          flash(msg);
          void refetch();
        } else if (!online || msg.includes("fetch")) {
          warnOfflineStock();
          enqueueSale({ ...payload, sincronizada_offline: true, queued_at: new Date().toISOString() });
          setPendingOffline(loadOfflineQueue().length);
          flash(`Venta en cola offline: ${method}`);
          resetAfterSale();
        } else {
          flash(msg);
        }
      } finally {
        setProcessing(false);
      }
    },
    [cart, catalog, online, processing, flash, resetAfterSale, queryClient, refetch, selectedCliente],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); focusScan(); }
      if (e.key === "F3") { e.preventDefault(); /* selector via header */ }
      if (e.key === "F8") { e.preventDefault(); void handlePay("Efectivo"); }
      if (e.key === "F9") { e.preventDefault(); void handlePay("Débito/Crédito"); }
      if (e.key === "F10") { e.preventDefault(); void handlePay("Mercado Pago QR"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusScan, handlePay]);

  const updateQty = (code: string, delta: number) => {
    setCart((prev) =>
      prev.map((i) => {
        if (i.codigo_interno.toLowerCase() !== code.toLowerCase()) return i;
        const product = findCatalogProduct(catalog, code);
        const maxStock = product?.stock ?? i.qty;
        const nextQty = Math.min(maxStock, Math.max(1, i.qty + delta));
        const base = i.base_precio_venta ?? product?.precio_venta ?? i.precio_venta;
        const tiers = i.price_tiers ?? product?.price_tiers ?? [];
        return {
          ...i,
          qty: nextQty,
          base_precio_venta: base,
          price_tiers: tiers,
          precio_venta: resolveUnitPrice(base, tiers, nextQty),
        };
      }),
    );
  };

  const removeItem = (code: string) =>
    setCart((prev) => prev.filter((i) => i.codigo_interno !== code));

  const total = useMemo(() => cart.reduce((s, i) => s + i.qty * i.precio_venta, 0), [cart]);
  const itemCount = useMemo(() => cart.reduce((s, i) => s + i.qty, 0), [cart]);

  useEffect(() => {
    if (cart.length === 0 && mobileStep === "cobro") {
      setMobileStep("precios");
    }
  }, [cart.length, mobileStep]);

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

  const handleLogout = () => {
    clearToken();
    void navigate({ to: "/login" });
  };

  const connectionBadge = (
    <button
      onClick={() => void toggleOnline()}
      className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-md border text-xs font-semibold tracking-wide transition-colors ${
        online
          ? "border-online/40 bg-online/10 text-online hover:bg-online/20"
          : "border-offline/40 bg-offline/10 text-offline hover:bg-offline/20"
      }`}
      title="Estado de conexión API"
    >
      {online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
      <span className="hidden sm:inline">{online ? "ONLINE" : "OFFLINE"}</span>
      <span className={`size-1.5 rounded-full ${online ? "bg-online" : "bg-offline"} animate-pulse`} />
    </button>
  );

  // Una sola instancia de CustomerSelector según viewport / paso.
  const showCustomerInHeader = isLg;
  const showCustomerInCobro = !isLg && mobileStep === "cobro" && !menuOpen;
  const showCustomerInSheet = !isLg && menuOpen;
  const customerSelector = (
    <CustomerSelector
      selected={selectedCliente}
      onSelect={setSelectedCliente}
      onCreate={createCliente}
    />
  );

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden bg-midnight text-foreground font-mono">
      <header className="h-14 shrink-0 border-b border-border bg-charcoal flex items-center px-3 sm:px-5 gap-2 sm:gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className="size-8 shrink-0 rounded-md bg-primary grid place-items-center text-primary-foreground font-bold">
            R
          </div>
          <div className="leading-tight min-w-0 hidden sm:block">
            <div className="text-sm font-semibold text-silver-light truncate">Radio Colonia POS</div>
            <div className="text-[11px] text-silver">Caja 01 · Omnicanal</div>
          </div>
        </div>

        <div className="flex-1" />

        {/* Desktop: full header controls */}
        <div className="hidden lg:flex items-center gap-4">
          {showCustomerInHeader && customerSelector}

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

          <Link
            to="/compras"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs text-silver hover:text-silver-light hover:bg-charcoal"
            title="Compras e importación de facturas"
          >
            <Package className="size-3.5" />
            Compras
          </Link>

          {connectionBadge}

          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs text-silver hover:text-silver-light hover:bg-charcoal"
            title="Cerrar sesión"
          >
            <LogOut className="size-3.5" />
            Salir
          </button>

          <PosClock />
        </div>

        {/* Mobile / tablet: compact badge + menu */}
        <div className="flex lg:hidden items-center gap-2">
          {connectionBadge}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="p-2 rounded-md border border-border text-silver hover:text-silver-light"
                aria-label="Menú"
              >
                <Menu className="size-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="bg-charcoal border-border text-silver-light w-[85vw] sm:max-w-sm">
              <SheetHeader>
                <SheetTitle className="text-silver-light">Menú caja</SheetTitle>
              </SheetHeader>
              <div className="mt-6 flex flex-col gap-4">
                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-widest text-silver font-bold">Cliente</div>
                  {showCustomerInSheet && customerSelector}
                </div>

                {pendingOffline > 0 && (
                  <div className="text-sm text-offline font-semibold">
                    Cola offline: {pendingOffline}
                  </div>
                )}

                <Button
                  variant="outline"
                  className="justify-start border-border text-silver-light gap-2"
                  onClick={() => {
                    void refetch();
                    setMenuOpen(false);
                  }}
                >
                  <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
                  Actualizar catálogo
                </Button>

                <Button
                  variant="outline"
                  className="justify-start border-border text-silver-light gap-2"
                  onClick={() => {
                    setMenuOpen(false);
                    void navigate({ to: "/compras" });
                  }}
                >
                  <Package className="size-4" />
                  Compras
                </Button>

                <Button
                  variant="outline"
                  className="justify-start border-border text-silver-light gap-2"
                  onClick={() => {
                    handleLogout();
                    setMenuOpen(false);
                  }}
                >
                  <LogOut className="size-4" />
                  Cerrar sesión
                </Button>

                <div className="pt-2 border-t border-border text-sm text-silver tabular-nums">
                  <PosClock compact className="text-sm text-silver tabular-nums" />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {isError && (
        <div className="px-4 sm:px-5 py-2 bg-offline/10 text-offline text-xs border-b border-offline/30">
          No se pudo cargar el catálogo. Verificá que el backend esté en ejecución (puerto 3001).
        </div>
      )}

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[65%_35%] min-h-0 overflow-hidden">
        {/* Cart / cobro panel — visible on mobile only in cobro step; always on lg */}
        <section
          className={`${mobileStep === "cobro" ? "flex" : "hidden"} lg:flex border-r border-border flex-col min-h-0`}
        >
          <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-border bg-charcoal/60 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => setMobileStep("precios")}
                className="lg:hidden flex items-center gap-1 text-xs text-primary font-semibold shrink-0"
              >
                <ChevronLeft className="size-4" />
                Seguir agregando
              </button>
              <h2 className="hidden lg:block text-xs font-bold uppercase tracking-widest text-silver">
                Venta en curso
              </h2>
            </div>
            <div className="text-xs text-silver shrink-0">
              {cart.length} ítems · {itemCount} unidades
            </div>
          </div>

          {/* Mobile: customer selector on cobro step */}
          <div className="lg:hidden px-4 py-3 border-b border-border bg-charcoal/40">
            <div className="text-[11px] uppercase tracking-widest text-silver font-bold mb-2">Cliente</div>
            {showCustomerInCobro && customerSelector}
          </div>

          {/* Mobile cart cards */}
          <div className="lg:hidden flex-1 overflow-auto divide-y divide-border/40">
            {cart.length === 0 && (
              <div className="px-5 py-16 text-center text-silver/60">
                <ScanLine className="size-10 mx-auto mb-3 opacity-50" />
                <div className="text-sm">Carrito vacío</div>
                <div className="text-xs mt-1">Volvé a precios para agregar productos</div>
              </div>
            )}
            {cart.map((item) => (
              <div key={item.codigo_interno} className="px-4 py-3 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm text-silver-light font-medium leading-snug">{item.nombre}</div>
                    <div className="text-[11px] uppercase tracking-wider text-primary font-bold mt-0.5">
                      {item.codigo_interno}
                    </div>
                  </div>
                  <button
                    onClick={() => removeItem(item.codigo_interno)}
                    className="size-10 shrink-0 grid place-items-center rounded-md text-silver hover:bg-destructive/15 hover:text-destructive transition-colors"
                    aria-label="Eliminar"
                  >
                    <Trash2 className="size-5" />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateQty(item.codigo_interno, -1)}
                      className="size-10 rounded-md border border-border text-lg text-silver hover:bg-charcoal hover:text-silver-light"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-base text-silver-light tabular-nums font-semibold">
                      {item.qty}
                    </span>
                    <button
                      onClick={() => updateQty(item.codigo_interno, +1)}
                      className="size-10 rounded-md border border-border text-lg text-silver hover:bg-charcoal hover:text-silver-light"
                    >
                      +
                    </button>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-silver tabular-nums">
                      {formatARS(item.precio_venta)} c/u
                      {Math.abs(item.precio_venta - (item.base_precio_venta || item.precio_venta)) > 0.009 && (
                        <span className="ml-1 text-primary">· qty</span>
                      )}
                    </div>
                    <div className="text-sm text-silver-light font-semibold tabular-nums">
                      {formatARS(item.precio_venta * item.qty)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table cart */}
          <div className="hidden lg:block flex-1 overflow-auto">
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
                    <td className="px-3 py-3 text-right text-silver tabular-nums">
                      {formatARS(item.precio_venta)}
                      {Math.abs(item.precio_venta - (item.base_precio_venta || item.precio_venta)) > 0.009 && (
                        <span className="block text-[10px] text-primary">desc. cantidad</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-silver-light font-semibold tabular-nums">
                      {formatARS(item.precio_venta * item.qty)}
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

          {/* Mobile payment buttons (step 2) */}
          <div className="lg:hidden shrink-0 border-t-2 border-primary bg-charcoal pb-safe">
            <div className="px-4 pt-3 pb-1">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-widest text-silver font-bold">Total a pagar</div>
                  <div className="text-[10px] text-silver/70 mt-0.5">{itemCount} unidades · IVA incluido</div>
                </div>
                <div className="text-3xl font-bold text-silver-light tabular-nums leading-none">
                  <span className="text-primary mr-1">$</span>
                  {new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(total)}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-0 mt-2">
              <PayBtn label="F8" name="Efectivo" onClick={() => void handlePay("Efectivo")} disabled={processing || cart.length === 0} hideShortcut />
              <PayBtn label="F9" name="Débito/Crédito" onClick={() => void handlePay("Débito/Crédito")} disabled={processing || cart.length === 0} hideShortcut />
              <PayBtn label="F10" name="Mercado Pago QR" onClick={() => void handlePay("Mercado Pago QR")} primary disabled={processing || cart.length === 0} hideShortcut />
            </div>
          </div>
        </section>

        {/* Catalog / precios panel — visible on mobile only in precios step; always on lg */}
        <aside
          className={`${mobileStep === "precios" ? "flex" : "hidden"} lg:flex flex-col min-h-0 overflow-hidden bg-charcoal/40`}
        >
          <div className="shrink-0 p-4 sm:p-5 border-b border-border relative">
            <label className="text-[11px] uppercase tracking-widest text-silver font-bold">Escaneo</label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitScan();
              }}
              className="mt-2 relative"
            >
              <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-primary" />
              <input
                ref={scanRef}
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={handleScanKeyDown}
                onBlur={() => {
                  if (!isCoarsePointer()) setTimeout(focusScan, 0);
                }}
                placeholder="Buscar código o nombre"
                role="combobox"
                aria-expanded={searchResults.length > 0}
                aria-autocomplete="list"
                aria-activedescendant={
                  searchResults.length > 0 ? `pos-search-result-${highlightedIndex}` : undefined
                }
                className="w-full h-12 sm:h-14 pl-11 pr-4 rounded-lg bg-midnight border-2 border-primary text-silver-light placeholder:text-silver/50 text-base font-semibold tracking-wide outline-none focus:ring-2 focus:ring-primary/40 shadow-[0_0_0_3px_hsl(24_95%_53%/0.08)]"
                autoComplete="off"
                disabled={isLoading}
              />
            </form>

            {scan.trim() && searchResults.length > 0 && (
              <div
                role="listbox"
                className="absolute left-4 right-4 sm:left-5 sm:right-5 top-full z-30 mt-1 rounded-lg bg-midnight border border-primary/60 shadow-2xl max-h-72 overflow-auto"
              >
                {searchResults.map((p, idx) => (
                  <button
                    key={p.codigo_interno}
                    id={`pos-search-result-${idx}`}
                    ref={(el) => {
                      searchResultRefs.current[idx] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={idx === highlightedIndex}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectSearchResult(p);
                    }}
                    className={`w-full flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-3 py-3 sm:py-2 text-left border-b border-border/40 last:border-0 ${
                      idx === highlightedIndex
                        ? "bg-primary/15 ring-1 ring-inset ring-primary/50"
                        : "hover:bg-charcoal"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-[10px] uppercase tracking-wider text-primary font-bold shrink-0">
                        {p.codigo_interno}
                      </span>
                      <span className="flex-1 text-sm sm:text-xs text-silver-light truncate">{p.nombre}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-silver-light font-semibold tabular-nums">{formatCatalogPrice(p, formatARS)}</span>
                      <span className="text-silver/60">stk {p.stock}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-4 sm:px-5 py-3 border-b border-border bg-charcoal/60">
              <h3 className="text-[11px] uppercase tracking-widest text-silver font-bold">Lista de precios</h3>
              <span className="text-[11px] text-silver">
                {isLoading ? "Cargando…" : `${sortedCatalog.length} ítems · A–Z`}
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border/40 pb-20 lg:pb-0">
              {sortedCatalog.map((p) => (
                <button
                  key={p.codigo_interno}
                  type="button"
                  onClick={() => {
                    if (p.stock <= 0) {
                      flash(`Sin stock: ${p.nombre}`);
                      return;
                    }
                    promptAddProduct(p);
                  }}
                  disabled={p.stock <= 0}
                  className="group w-full flex flex-col sm:grid sm:grid-cols-[auto_1fr_auto_auto] sm:items-center gap-1 sm:gap-3 px-4 sm:px-5 py-3.5 sm:py-2.5 text-left hover:bg-charcoal transition-colors disabled:opacity-40 min-h-14"
                >
                  <div className="flex items-center gap-2 min-w-0 sm:contents">
                    <span className="text-[10px] uppercase tracking-wider text-primary font-bold sm:w-20 shrink-0">
                      {p.codigo_interno}
                    </span>
                    <span className="text-sm sm:text-xs text-silver-light truncate flex-1">{p.nombre}</span>
                  </div>
                  <div className="flex items-center justify-between sm:contents gap-3">
                    <span className="text-sm sm:text-xs font-semibold text-silver-light tabular-nums">
                      {formatCatalogPrice(p, formatARS)}
                    </span>
                    <span className="sm:hidden text-[11px] text-silver/60">stk {p.stock}</span>
                    <Plus className="hidden sm:block size-3.5 text-silver/40 group-hover:text-primary" />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Mobile bottom bar — step 1: go to cobro */}
          <div className="lg:hidden shrink-0 border-t-2 border-primary bg-charcoal pb-safe">
            <button
              type="button"
              disabled={cart.length === 0}
              onClick={() => setMobileStep("cobro")}
              className="w-full flex items-center justify-between gap-3 px-4 py-4 disabled:opacity-40 transition-colors hover:bg-midnight/40"
            >
              <div className="text-left">
                <div className="text-[11px] uppercase tracking-widest text-silver font-bold">
                  {itemCount} {itemCount === 1 ? "unidad" : "unidades"}
                </div>
                <div className="text-2xl font-bold text-silver-light tabular-nums leading-none mt-1">
                  <span className="text-primary mr-1">$</span>
                  {new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(total)}
                </div>
              </div>
              <span className="rounded-md bg-primary text-primary-foreground px-4 py-2.5 text-sm font-bold uppercase tracking-wide">
                Cobrar
              </span>
            </button>
          </div>
        </aside>
      </main>

      {/* Desktop footer */}
      <footer className="hidden lg:block shrink-0 border-t-2 border-primary bg-charcoal">
        <div className="grid grid-cols-[65%_35%]">
          <div className="px-6 py-5 flex items-center justify-between border-r border-border">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-silver font-bold">Total a pagar</div>
              <div className="text-[10px] text-silver/70 mt-0.5">{itemCount} unidades · IVA incluido</div>
            </div>
            <div className="text-right">
              <div className="text-5xl font-bold text-silver-light tabular-nums leading-none">
                <span className="text-primary mr-2">$</span>
                {new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(total)}
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
        <div className="fixed top-16 left-4 right-4 sm:left-auto sm:right-6 sm:top-20 z-50 px-4 py-3 rounded-md bg-charcoal border border-primary text-silver-light text-sm shadow-xl sm:max-w-sm text-center sm:text-left">
          {toast}
        </div>
      )}

      <FiscalResultDialog
        open={fiscalDialogOpen}
        onOpenChange={setFiscalDialogOpen}
        fiscal={lastFiscal}
        ventaId={lastVentaId}
        total={lastSaleTotal}
        formatMoney={formatARS}
      />

      <Dialog open={pendingProduct !== null} onOpenChange={(open) => { if (!open) closeQtyDialog(); }}>
        <DialogContent
          className="bg-charcoal border-border text-silver-light sm:max-w-md"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              confirmAddProduct();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-silver-light">Cantidad a agregar</DialogTitle>
            <DialogDescription className="text-silver">
              {pendingProduct?.nombre}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            <div className="flex items-center justify-between text-xs text-silver">
              <span className="uppercase tracking-wider font-bold">{pendingProduct?.codigo_interno}</span>
              <span className="tabular-nums">
                {pendingProduct ? `${formatARS(pendingUnitPrice)} c/u` : ""}
                {pendingProduct &&
                  Math.abs(pendingUnitPrice - pendingProduct.precio_venta) > 0.009 && (
                    <span className="text-silver/50 line-through ml-1">
                      {formatARS(pendingProduct.precio_venta)}
                    </span>
                  )}
                {pendingProduct ? ` · stk ${pendingProduct.stock}` : ""}
              </span>
            </div>
            <Input
              ref={qtyRef}
              type="number"
              min={1}
              max={pendingProduct?.stock ?? 1}
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              className="h-12 text-lg font-semibold tabular-nums bg-midnight border-primary text-silver-light"
              autoFocus
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={closeQtyDialog} className="border-border text-silver-light">
              Cancelar
            </Button>
            <Button type="button" onClick={confirmAddProduct} className="bg-primary text-primary-foreground hover:bg-accent">
              Agregar al carrito
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PayBtn({
  label,
  name,
  onClick,
  primary,
  disabled,
  hideShortcut,
}: {
  label: string;
  name: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  hideShortcut?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group h-full py-4 sm:py-5 px-4 border-t lg:border-t-0 lg:border-l border-border flex flex-col items-center justify-center gap-1 transition-colors disabled:opacity-50 ${
        primary
          ? "bg-primary text-primary-foreground hover:bg-accent"
          : "bg-charcoal text-silver-light hover:bg-midnight"
      }`}
    >
      {!hideShortcut && (
        <span className={`hidden lg:inline text-[11px] font-bold tracking-widest ${primary ? "text-primary-foreground/80" : "text-primary"}`}>
          {label}
        </span>
      )}
      <span className="text-sm font-bold uppercase tracking-wide">{name}</span>
    </button>
  );
}
