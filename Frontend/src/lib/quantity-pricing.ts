export type PriceTier = { minQty: number; unitPrice: number };

/** Deduplicate by minQty (keep last), sort ascending by minQty. */
export function normalizeTiers(tiers: PriceTier[]): PriceTier[] {
  const byMin = new Map<number, number>();
  for (const t of tiers) {
    if (!Number.isFinite(t.minQty) || t.minQty < 2) continue;
    if (!Number.isFinite(t.unitPrice) || t.unitPrice <= 0) continue;
    byMin.set(Math.floor(t.minQty), t.unitPrice);
  }
  return Array.from(byMin.entries())
    .map(([minQty, unitPrice]) => ({ minQty, unitPrice }))
    .sort((a, b) => a.minQty - b.minQty);
}

/**
 * All-units pricing: applicable tier = highest minQty <= qty.
 * No matching tier → basePrice.
 */
export function resolveUnitPrice(
  basePrice: number,
  tiers: PriceTier[],
  qty: number,
): number {
  const normalized = normalizeTiers(tiers);
  const q = Math.max(1, Math.floor(qty) || 1);
  let applied = basePrice;
  for (const t of normalized) {
    if (t.minQty <= q) applied = t.unitPrice;
    else break;
  }
  return applied;
}

/** For listings: [lowest reachable unit price, unit price at qty 1]. */
export function priceRange(
  basePrice: number,
  tiers: PriceTier[],
): { min: number; max: number } {
  const normalized = normalizeTiers(tiers);
  const max = basePrice;
  if (normalized.length === 0) return { min: max, max };
  const tierMin = Math.min(...normalized.map((t) => t.unitPrice));
  return { min: Math.min(tierMin, max), max };
}
