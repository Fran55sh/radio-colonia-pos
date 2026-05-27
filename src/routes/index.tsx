import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Trash2, Wifi, WifiOff, ScanLine, Plus } from "lucide-react";

export const Route = createFileRoute("/")({
  component: POS,
  head: () => ({
    meta: [
      { title: "POS — Punto de Venta" },
      { name: "description", content: "High-performance Point of Sale frontend for fast retail checkout." },
    ],
  }),
});

type Product = {
  code: string;
  name: string;
  price: number;
};

const CATALOG: Product[] = [
  { code: "ant-yagi", name: "Antena Yagi exterior 18dBi", price: 38900 },
  { code: "bnd-velcro", name: "Bridas velcro x 10", price: 2900 },
  { code: "utp5-020", name: "Cable UTP Cat5e x 20m", price: 8500 },
  { code: "utp6-050", name: "Cable UTP Cat6 x 50m", price: 24900 },
  { code: "cnv-sfp", name: "Conversor SFP a RJ45", price: 27500 },
  { code: "con-rj45", name: "Conector RJ45 (10u)", price: 3200 },
  { code: "fnt-poe", name: "Fuente PoE 48V 1.5A", price: 15900 },
  { code: "jck-keystone", name: "Jack keystone Cat6", price: 1800 },
  { code: "mod-fibra", name: "Módulo fibra LC multimodo", price: 32000 },
  { code: "ord-cables", name: "Organizador de cables 1U", price: 9900 },
  { code: "patch-1m", name: "Patch cord 1m Cat6", price: 2500 },
  { code: "patch-3m", name: "Patch cord 3m Cat6", price: 4200 },
  { code: "patch-pnl", name: "Patch panel 24 puertos", price: 42000 },
  { code: "crimp-rj", name: "Pinza crimpadora RJ45", price: 18500 },
  { code: "rack-9u", name: "Rack 9U pared", price: 165000 },
  { code: "router-ax", name: "Router WiFi 6 AX1800", price: 119000 },
  { code: "switch-8", name: "Switch 8 puertos Gigabit", price: 45900 },
  { code: "switch-24", name: "Switch 24 puertos PoE", price: 189000 },
  { code: "tester-rj", name: "Tester de red RJ45", price: 22000 },
  { code: "ups-650", name: "UPS 650VA línea interactiva", price: 79900 },
];

type CartItem = Product & { qty: number };

function formatCLP(n: number) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);
}

function POS() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [scan, setScan] = useState("");
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(new Date());
  const [toast, setToast] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const focusScan = useCallback(() => scanRef.current?.focus(), []);
  useEffect(() => { focusScan(); }, [focusScan]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); focusScan(); }
      if (e.key === "F8") { e.preventDefault(); handlePay("Efectivo"); }
      if (e.key === "F9") { e.preventDefault(); handlePay("Débito/Crédito"); }
      if (e.key === "F10") { e.preventDefault(); handlePay("Mercado Pago QR"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const addByCode = (raw: string) => {
    const code = raw.trim().toLowerCase();
    if (!code) return;
    const product = CATALOG.find((p) => p.code === code);
    if (!product) {
      flash(`Código "${raw}" no encontrado`);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((i) => i.code === product.code);
      if (existing) return prev.map((i) => i.code === product.code ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { ...product, qty: 1 }];
    });
    setScan("");
  };

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const updateQty = (code: string, delta: number) => {
    setCart((prev) => prev
      .map((i) => i.code === code ? { ...i, qty: Math.max(1, i.qty + delta) } : i));
  };

  const removeItem = (code: string) => setCart((prev) => prev.filter((i) => i.code !== code));

  const total = useMemo(() => cart.reduce((s, i) => s + i.qty * i.price, 0), [cart]);
  const itemCount = useMemo(() => cart.reduce((s, i) => s + i.qty, 0), [cart]);

  const handlePay = (method: string) => {
    if (cart.length === 0) { flash("Carrito vacío"); return; }
    flash(`Venta cobrada: ${method} — ${formatCLP(total)}`);
    setCart([]);
    focusScan();
  };

  const toggleOnline = () => {
    setOnline((o) => {
      const next = !o;
      if (!next) flash("Operating in offline mode. Sales will queue locally.");
      else flash("Conexión restablecida.");
      return next;
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-midnight text-foreground font-mono">
      {/* Header */}
      <header className="h-14 shrink-0 border-b border-border bg-charcoal flex items-center px-5 gap-4">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-md bg-primary grid place-items-center text-primary-foreground font-bold">P</div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-silver-light">Punto de Venta</div>
            <div className="text-[11px] text-silver">Sucursal Centro · Caja 01 · Vendedor: Ana M.</div>
          </div>
        </div>

        <div className="flex-1" />

        <button
          onClick={toggleOnline}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-semibold tracking-wide transition-colors ${
            online
              ? "border-online/40 bg-online/10 text-online hover:bg-online/20"
              : "border-offline/40 bg-offline/10 text-offline hover:bg-offline/20"
          }`}
          title="Alternar modo offline"
        >
          {online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
          {online ? "ONLINE" : "OFFLINE MODE (Local Storage Enabled)"}
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

      {/* Main split view */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[65%_35%] min-h-0">
        {/* Cart */}
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
                      <div className="text-xs mt-1">Prueba: <span className="text-primary">utp5-020</span> · <span className="text-primary">con-rj45</span></div>
                    </td>
                  </tr>
                )}
                {cart.map((item) => (
                  <tr key={item.code} className="border-b border-border/60 hover:bg-charcoal/50 transition-colors">
                    <td className="px-5 py-3 text-primary font-semibold uppercase">{item.code}</td>
                    <td className="px-3 py-3 text-silver-light">{item.name}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => updateQty(item.code, -1)} className="size-6 rounded border border-border text-silver hover:bg-charcoal hover:text-silver-light">−</button>
                        <span className="w-8 text-center text-silver-light tabular-nums">{item.qty}</span>
                        <button onClick={() => updateQty(item.code, +1)} className="size-6 rounded border border-border text-silver hover:bg-charcoal hover:text-silver-light">+</button>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-silver tabular-nums">{formatCLP(item.price)}</td>
                    <td className="px-3 py-3 text-right text-silver-light font-semibold tabular-nums">{formatCLP(item.price * item.qty)}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => removeItem(item.code)}
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

        {/* Scan + price list */}
        <aside className="flex flex-col min-h-0 bg-charcoal/40">
          <div className="p-5 border-b border-border relative">
            <label className="text-[11px] uppercase tracking-widest text-silver font-bold">Escaneo</label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (filtered.length > 0 && scan.trim() && !CATALOG.find(p => p.code === scan.trim().toLowerCase())) {
                  addByCode(filtered[0].code);
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
              />
            </form>
            <p className="mt-2 text-[11px] text-silver">Presiona <kbd className="px-1.5 py-0.5 rounded bg-midnight border border-border text-silver-light">Enter</kbd> para agregar el primer resultado</p>

            {scan.trim() && filtered.length > 0 && (
              <div className="absolute left-5 right-5 top-[105px] z-30 mt-1 rounded-lg bg-midnight border border-primary/60 shadow-2xl max-h-72 overflow-auto">
                {filtered.slice(0, 8).map((p) => (
                  <button
                    key={p.code}
                    onMouseDown={(e) => { e.preventDefault(); addByCode(p.code); }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-charcoal border-b border-border/40 last:border-0"
                  >
                    <span className="text-[10px] uppercase tracking-wider text-primary font-bold w-20 shrink-0">{p.code}</span>
                    <span className="flex-1 text-xs text-silver-light truncate">{p.name}</span>
                    <span className="text-xs text-silver tabular-nums">{formatCLP(p.price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-charcoal/60">
              <h3 className="text-[11px] uppercase tracking-widest text-silver font-bold">Lista de precios</h3>
              <span className="text-[11px] text-silver">{sortedCatalog.length} ítems · A–Z</span>
            </div>
            <div className="flex-1 overflow-auto divide-y divide-border/40">
              {sortedCatalog.map((p) => (
                <button
                  key={p.code}
                  onClick={() => addByCode(p.code)}
                  className="group w-full grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-5 py-2.5 text-left hover:bg-charcoal transition-colors"
                >
                  <span className="text-[10px] uppercase tracking-wider text-primary font-bold w-20">{p.code}</span>
                  <span className="text-xs text-silver-light truncate">{p.name}</span>
                  <span className="text-xs font-semibold text-silver-light tabular-nums">{formatCLP(p.price)}</span>
                  <Plus className="size-3.5 text-silver/40 group-hover:text-primary" />
                </button>
              ))}
            </div>
          </div>
        </aside>
      </main>

      {/* Bottom summary */}
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
            <PayBtn label="F8" name="Efectivo" onClick={() => handlePay("Efectivo")} />
            <PayBtn label="F9" name="Débito/Crédito" onClick={() => handlePay("Débito/Crédito")} />
            <PayBtn label="F10" name="Mercado Pago QR" onClick={() => handlePay("Mercado Pago QR")} primary />
          </div>
        </div>
      </footer>

      {/* Toast */}
      {toast && (
        <div className="fixed top-20 right-6 z-50 px-4 py-3 rounded-md bg-charcoal border border-primary text-silver-light text-sm shadow-xl max-w-sm">
          {toast}
        </div>
      )}
    </div>
  );
}

function PayBtn({ label, name, onClick, primary }: { label: string; name: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`group h-full py-5 px-4 border-l border-border flex flex-col items-center justify-center gap-1 transition-colors ${
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
