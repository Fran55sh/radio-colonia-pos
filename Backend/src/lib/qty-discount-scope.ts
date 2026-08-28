import type { PriceTier } from "./quantity-pricing.js";

export type QtyDiscountScope = "per_variant" | "shared";

/** Tiers efectivos para un SKU según el alcance configurado en el producto. */
export function resolveVariantTiers(
  scope: QtyDiscountScope,
  productTiers: PriceTier[],
  variantTiers: PriceTier[],
): PriceTier[] {
  return scope === "shared" ? productTiers : variantTiers;
}

/**
 * Igual que ecommerce, con fallback si los tramos quedaron en la tabla opuesta
 * (p. ej. scope cambiado sin re-guardar en admin).
 */
export function resolveEffectiveTiers(
  scope: string | null | undefined,
  productTiers: PriceTier[],
  variantTiers: PriceTier[],
): PriceTier[] {
  const normalized: QtyDiscountScope = scope === "shared" ? "shared" : "per_variant";
  const primary = resolveVariantTiers(normalized, productTiers, variantTiers);
  if (primary.length > 0) return primary;
  return variantTiers.length > 0 ? variantTiers : productTiers;
}
