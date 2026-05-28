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

export function enqueueSale(sale: QueuedSale) {
  const queue = loadOfflineQueue();
  queue.push(sale);
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
