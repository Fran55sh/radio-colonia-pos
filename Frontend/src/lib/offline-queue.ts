import type { CreateSalePayload } from "./api-client";

const STORAGE_KEY = "radio-colonia-pos-offline-queue";

export type QueuedSale = CreateSalePayload & {
  client_sale_id: string;
  queued_at: string;
};

export function loadOfflineQueue(): QueuedSale[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueuedSale[];
  } catch {
    return [];
  }
}

export function saveOfflineQueue(queue: QueuedSale[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function clearOfflineQueue(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/** Encola venta sin PII de cliente (sin cliente_id). */
export function enqueueSale(sale: QueuedSale) {
  const queue = loadOfflineQueue();
  const { cliente_id: _omit, ...safe } = sale;
  queue.push({ ...safe, sincronizada_offline: true });
  saveOfflineQueue(queue);
}

export function removeFromQueue(clientSaleIds: string[]) {
  const ids = new Set(clientSaleIds);
  const queue = loadOfflineQueue().filter((s) => !ids.has(s.client_sale_id));
  saveOfflineQueue(queue);
  return queue;
}

export function generateClientSaleId(): string {
  return `offline-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

/** True si alguna línea supera el stock conocido del catálogo. */
export function exceedsKnownStock(
  lineas: Array<{ codigo_interno: string; cantidad: number }>,
  catalog: Array<{ codigo_interno: string; stock: number }>,
): { ok: true } | { ok: false; sku: string; available: number } {
  for (const line of lineas) {
    const product = catalog.find(
      (p) => p.codigo_interno.toLowerCase() === line.codigo_interno.toLowerCase(),
    );
    if (product != null && line.cantidad > product.stock) {
      return {
        ok: false,
        sku: line.codigo_interno,
        available: product.stock,
      };
    }
  }
  return { ok: true };
}
