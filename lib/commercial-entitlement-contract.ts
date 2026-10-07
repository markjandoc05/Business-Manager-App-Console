/**
 * Platform-owned bridge between commercial products and the stable
 * entitlement vocabulary understood by the Client App.
 *
 * Product codes are deliberately lowercase because they are Firestore document
 * IDs and API values. Display labels may use "FOUNDING_100" and "STANDARD",
 * but callers must never treat those labels as Client authorization tiers.
 */
export const STABLE_ENTITLEMENT_TIERS = ['SOLO', 'STARTER', 'TEAM', 'LEGACY'] as const;
export type StableEntitlementTier = typeof STABLE_ENTITLEMENT_TIERS[number];

export interface CommercialProductEntitlement {
  /** Stable paid tier that the product grants after its trial is converted. */
  entitlementTier: StableEntitlementTier;
  /**
   * Storage is not currently a commercial entitlement in Ventale. Keeping the
   * explicit null policy here makes a browser-supplied storage value fail
   * closed rather than becoming an accidental entitlement.
   */
  storageLimitBytes: null;
}

/**
 * Business decision: Founding 100 and Standard are price/availability offers
 * for the same product capability. Both grant STARTER. A price difference does
 * not create a different Client authorization tier.
 */
export const COMMERCIAL_PRODUCT_ENTITLEMENTS: Readonly<Record<string, CommercialProductEntitlement>> = Object.freeze({
  founding_100: Object.freeze({ entitlementTier: 'STARTER', storageLimitBytes: null }),
  standard: Object.freeze({ entitlementTier: 'STARTER', storageLimitBytes: null }),
});

export function isStableEntitlementTier(value: unknown): value is StableEntitlementTier {
  return typeof value === 'string' && (STABLE_ENTITLEMENT_TIERS as readonly string[]).includes(value);
}

/** Returns null for unknown products so every server caller can fail closed. */
export function commercialProductEntitlement(productCode: unknown): CommercialProductEntitlement | null {
  if (typeof productCode !== 'string') return null;
  return COMMERCIAL_PRODUCT_ENTITLEMENTS[productCode] || null;
}
