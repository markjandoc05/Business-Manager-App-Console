import { commercialProductEntitlement, type StableEntitlementTier } from './commercial-entitlement-contract.ts';

export const SUBSCRIPTION_PLAN_COLLECTION = 'platformPlans';
export const SUBSCRIPTION_PLAN_USAGE_COLLECTION = 'platformPlanUsage';
/** Default for existing Founding catalog documents written before this field. */
export const DEFAULT_FOUNDING_CUSTOMER_LIMIT = 100;
export const MAX_FOUNDING_CUSTOMER_LIMIT = 100_000;

export const SUBSCRIPTION_PLAN_IDS = ['founding_100', 'standard'] as const;
export type SubscriptionPlanId = typeof SUBSCRIPTION_PLAN_IDS[number] | (string & {});

export const SUBSCRIPTION_BILLING_INTERVALS = ['year'] as const;
export type SubscriptionBillingInterval = typeof SUBSCRIPTION_BILLING_INTERVALS[number];

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'expired', 'cancelled'] as const;
export type SubscriptionStatus = typeof SUBSCRIPTION_STATUSES[number];

/**
 * Platform-authored presentation copy. It is deliberately separate from
 * entitlement, availability, and all provisioning inputs.
 */
export interface SubscriptionPlanMarketing {
  badge?: string;
  messages: string[];
}

export interface SubscriptionPlan {
  planId: string;
  code: string;
  /** Platform-owned stable entitlement granted by this commercial product. */
  entitlementTier: StableEntitlementTier;
  displayName: string;
  price: number;
  currency: string;
  billingInterval: SubscriptionBillingInterval;
  trialDays: number;
  noCreditCardRequired: boolean;
  /**
   * Server-owned capacity for the `founding_100` commercial product. It is
   * null for uncapped products. This is the authoritative allocation limit.
   */
  foundingLimit: number | null;
  /**
   * Compatibility projection retained for established Console read models.
   * For Founding it is always normalized to `foundingLimit`; it is never an
   * independently editable enrollment policy.
   */
  maxEligibleCustomers: number | null;
  publicSignup: boolean;
  /** Optional public, display-only copy for an available commercial offer. */
  marketing?: SubscriptionPlanMarketing;
  /** Server-owned marketing-edit metadata. It is never part of public plans. */
  marketingUpdatedAt?: unknown;
  marketingUpdatedByUid?: string;
  marketingRevision: number;
  /** Reserved for a future automatic rollover job. Manual switching is used now. */
  autoRolloverEnabled: boolean;
  autoRolloverPlanId: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: string;
}

export interface SubscriptionPlanUsage {
  planId: string;
  eligibleCustomerCount: number;
  limit: number | null;
  remaining: number | null;
  isFull: boolean;
  source: 'counter';
  updatedAt?: unknown;
}

export const DEFAULT_SUBSCRIPTION_PLANS: Record<string, Omit<SubscriptionPlan, 'createdAt' | 'updatedAt' | 'updatedBy'>> = {
  founding_100: {
    planId: 'founding_100',
    code: 'founding_100',
    entitlementTier: 'STARTER',
    displayName: 'Founding 100',
    price: 99,
    currency: 'USD',
    billingInterval: 'year',
    trialDays: 14,
    noCreditCardRequired: true,
    foundingLimit: DEFAULT_FOUNDING_CUSTOMER_LIMIT,
    maxEligibleCustomers: DEFAULT_FOUNDING_CUSTOMER_LIMIT,
    publicSignup: true,
    marketing: {
      badge: 'Limited to the first 100 customers',
      messages: [
        'Keep your Founding rate for as long as your subscription remains active.',
        'Standard price after the first 100: $149/year',
      ],
    },
    marketingRevision: 0,
    autoRolloverEnabled: false,
    autoRolloverPlanId: 'standard',
  },
  standard: {
    planId: 'standard',
    code: 'standard',
    entitlementTier: 'STARTER',
    displayName: 'Standard',
    price: 149,
    currency: 'USD',
    billingInterval: 'year',
    trialDays: 14,
    noCreditCardRequired: true,
    foundingLimit: null,
    maxEligibleCustomers: null,
    publicSignup: false,
    marketingRevision: 0,
    autoRolloverEnabled: false,
    autoRolloverPlanId: null,
  },
};

function cloneMarketing(marketing: SubscriptionPlanMarketing | undefined) {
  return marketing ? { badge: marketing.badge, messages: [...marketing.messages] } : undefined;
}

function hasPlainText(value: string) {
  return !/[<>]|&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]+);/i.test(value);
}

/** `null` is the persisted explicit-clear marker; `false` is invalid input. */
export function parseSubscriptionPlanMarketing(value: unknown): SubscriptionPlanMarketing | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => key !== 'badge' && key !== 'messages')) return false;
  if (data.badge !== undefined && (typeof data.badge !== 'string' || !data.badge.trim() || data.badge.trim().length > 160 || !hasPlainText(data.badge))) return false;
  if (!Array.isArray(data.messages) || data.messages.length < 1 || data.messages.length > 3) return false;
  if (data.messages.some((message) => typeof message !== 'string' || !message.trim() || message.trim().length > 300 || !hasPlainText(message))) return false;
  return {
    ...(typeof data.badge === 'string' ? { badge: data.badge.trim() } : {}),
    messages: data.messages.map((message) => (message as string).trim()),
  };
}

export function defaultSubscriptionPlan(planId: string): SubscriptionPlan | null {
  const plan = DEFAULT_SUBSCRIPTION_PLANS[planId];
  return plan ? { ...plan, marketing: cloneMarketing(plan.marketing) } : null;
}

export function isSubscriptionPlanId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value) && value.length <= 80;
}

export function isFoundingCustomerLimit(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= MAX_FOUNDING_CUSTOMER_LIMIT;
}

/**
 * All eligibility and allocation code must use this helper rather than the
 * legacy-compatible projection field. It keeps the policy in one trusted
 * catalog value while Standard remains uncapped.
 */
export function subscriptionPlanCustomerLimit(plan: Pick<SubscriptionPlan, 'planId' | 'foundingLimit' | 'maxEligibleCustomers'>) {
  return plan.planId === 'founding_100' ? plan.foundingLimit : plan.maxEligibleCustomers;
}

export function parseSubscriptionPlan(planId: string, data: Record<string, unknown>): SubscriptionPlan | null {
  if (!isSubscriptionPlanId(planId) || data.code !== planId || typeof data.displayName !== 'string' || !data.displayName.trim()) return null;
  const commercialEntitlement = commercialProductEntitlement(planId);
  // A persisted mapping is a projection of the platform-owned contract, not a
  // Console-editable value. Old catalog documents may omit it; any conflicting
  // value fails closed rather than changing a customer's granted tier.
  if (!commercialEntitlement || (data.entitlementTier !== undefined && data.entitlementTier !== commercialEntitlement.entitlementTier)) return null;
  if (typeof data.price !== 'number' || !Number.isFinite(data.price) || data.price < 0) return null;
  if (data.currency !== 'USD') return null;
  if (data.billingInterval !== 'year') return null;
  if (typeof data.trialDays !== 'number' || !Number.isInteger(data.trialDays) || data.trialDays < 1 || data.trialDays > 365) return null;
  if (typeof data.noCreditCardRequired !== 'boolean' || typeof data.publicSignup !== 'boolean') return null;
  let foundingLimit: number | null;
  let maxEligibleCustomers: number | null;
  if (planId === 'founding_100') {
    // Pre-capacity-field catalog documents were fixed at 100. Reading one is
    // safe and non-mutating: it resolves to the historical default until an
    // explicitly authorized bootstrap/backfill or capacity update persists it.
    const resolvedLimit = data.foundingLimit === undefined
      ? DEFAULT_FOUNDING_CUSTOMER_LIMIT
      : data.foundingLimit;
    if (!isFoundingCustomerLimit(resolvedLimit)) return null;
    if (data.maxEligibleCustomers !== undefined && data.maxEligibleCustomers !== resolvedLimit) return null;
    foundingLimit = resolvedLimit;
    maxEligibleCustomers = resolvedLimit;
  } else {
    // Standard remains intentionally uncapped. A browser or generic plan
    // update cannot repurpose the Founding-only capacity setting for it.
    if (data.foundingLimit !== undefined && data.foundingLimit !== null) return null;
    if (data.maxEligibleCustomers !== undefined && data.maxEligibleCustomers !== null) return null;
    foundingLimit = null;
    maxEligibleCustomers = null;
  }
  // Automatic rollover is deliberately reserved, not enabled. Fail closed if
  // a persisted plan attempts to turn it on before an explicit future rollout.
  if (data.autoRolloverEnabled !== undefined && data.autoRolloverEnabled !== false) return null;
  if (data.autoRolloverPlanId !== undefined && data.autoRolloverPlanId !== null && !isSubscriptionPlanId(data.autoRolloverPlanId)) return null;
  // Existing persisted catalog records can predate this display-only field.
  // In that case, use the same platform-owned default configuration without
  // requiring a production data migration or changing eligibility behavior.
  const marketing = parseSubscriptionPlanMarketing(data.marketing === undefined ? DEFAULT_SUBSCRIPTION_PLANS[planId]?.marketing : data.marketing);
  if (marketing === false) return null;
  const marketingRevision = data.marketingRevision === undefined ? 0 : data.marketingRevision;
  if (typeof marketingRevision !== 'number' || !Number.isInteger(marketingRevision) || marketingRevision < 0) return null;
  if (data.marketingUpdatedByUid !== undefined && (typeof data.marketingUpdatedByUid !== 'string' || !data.marketingUpdatedByUid.trim() || data.marketingUpdatedByUid.length > 256)) return null;
  return {
    planId,
    code: planId,
    entitlementTier: commercialEntitlement.entitlementTier,
    displayName: data.displayName.trim(),
    price: data.price,
    currency: 'USD',
    billingInterval: 'year',
    trialDays: data.trialDays,
    noCreditCardRequired: data.noCreditCardRequired,
    foundingLimit,
    maxEligibleCustomers,
    publicSignup: data.publicSignup,
    ...(marketing ? { marketing } : {}),
    marketingUpdatedAt: data.marketingUpdatedAt,
    marketingUpdatedByUid: typeof data.marketingUpdatedByUid === 'string' ? data.marketingUpdatedByUid : undefined,
    marketingRevision,
    autoRolloverEnabled: false,
    autoRolloverPlanId: typeof data.autoRolloverPlanId === 'string' ? data.autoRolloverPlanId : null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
  };
}

export function isEligibleSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === 'string' && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

export function subscriptionStatusIsEligible(value: unknown): boolean {
  return value === 'trialing' || value === 'active';
}

export function buildSubscriptionPlanUsage(plan: SubscriptionPlan, eligibleCustomerCount: number, updatedAt?: unknown): SubscriptionPlanUsage {
  const count = Math.max(0, Math.floor(eligibleCustomerCount));
  const limit = subscriptionPlanCustomerLimit(plan);
  return {
    planId: plan.planId,
    eligibleCustomerCount: count,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - count),
    isFull: limit !== null && count >= limit,
    source: 'counter',
    updatedAt,
  };
}

export function publicSubscriptionPlan(plan: SubscriptionPlan) {
  return {
    planId: plan.planId,
    code: plan.code,
    name: plan.displayName,
    displayName: plan.displayName,
    price: plan.price,
    currency: plan.currency,
    billingInterval: plan.billingInterval,
    trialDays: plan.trialDays,
    noCreditCardRequired: plan.noCreditCardRequired,
    maxEligibleCustomers: plan.maxEligibleCustomers,
    publicSignup: plan.publicSignup,
    ...(plan.marketing ? { marketing: cloneMarketing(plan.marketing) } : {}),
  };
}
