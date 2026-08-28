import { useEffect, useState } from "react";

/** Reloj aislado: evita re-render del POS completo cada segundo. */
export function PosClock({ className, compact }: { className?: string; compact?: boolean }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (compact) {
    return (
      <div className={className}>
        {now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        {" · "}
        {now.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "short" })}
      </div>
    );
  }

  return (
    <div className={className ?? "text-right leading-tight"}>
      <div className="text-sm text-silver-light tabular-nums">
        {now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </div>
      <div className="text-[11px] text-silver">
        {now.toLocaleDateString("es-AR", {
          weekday: "short",
          day: "2-digit",
          month: "short",
          year: "numeric",
        })}
      </div>
    </div>
  );
}
