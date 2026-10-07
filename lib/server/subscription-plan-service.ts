import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin-core';
import { listCanonicalLicenseDocumentsForPlan, listCanonicalLicenseDocumentsForPlanInTransaction } from './canonical-license-query';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { ApiError } from './api-errors';
import { enumValue, integer, requiredString } from './request';
import type { AuthenticatedPlatformAdmin } from './platform-admin';
import { parseCanonicalLicense } from '../license-contract';
import {
  DEFAULT_SUBSCRIPTION_PLANS,
  MAX_FOUNDING_CUSTOMER_LIMIT,
  SUBSCRIPTION_BILLING_INTERVALS,
  SUBSCRIPTION_PLAN_COLLECTION,
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_PLAN_USAGE_COLLECTION,
  buildSubscriptionPlanUsage,
  defaultSubscriptionPlan,
  isSubscriptionPlanId,
  parseSubscriptionPlanMarketing,
  parseSubscriptionPlan,
  publicSubscriptionPlan,
  subscriptionPlanCustomerLimit,
  subscriptionStatusIsEligible,
  type SubscriptionPlan,
  type SubscriptionPlanMarketing,
  type SubscriptionPlanUsage,
} from '../subscription-plan-contract';

const PLAN_UPDATE_FIELDS = [
  'displayName',
  'price',
  'currency',
  'billingInterval',
  'trialDays',
  'noCreditCardRequired',
  'publicSignup',
] as const;
const PLAN_MARKETING_UPDATE_FIELDS = ['marketing', 'expectedRevision'] as const;
const PLAN_MARKETING_CLEAR_FIELDS = ['expectedRevision'] as const;
const FOUNDING_CAPACITY_UPDATE_FIELDS = ['foundingLimit'] as const;

type SubscriptionPlanListItem = SubscriptionPlan & {
  source: 'persisted' | 'default';
  usage: SubscriptionPlanUsage;
};

/**
 * Read-only catalog inspection for operational health. Defaults intentionally
 * do not conceal a missing persisted launch-plan document from operators.
 */
export interface SubscriptionPlanCatalogInspection {
  missingPlanIds: string[];
  invalidPlanIds: string[];
  available: boolean;
}

function jsonSafe(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item) ?? null);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const safeItem = jsonSafe(item);
      if (safeItem !== undefined) result[key] = safeItem;
    }
    return result;
  }
  return value;
}

/** Firestore rejects undefined values even in merge writes. Keep optional
 * read-model fields out of persistence unless they have a concrete value. */
function omitUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function planRef(planId: string) {
  return adminDb.collection(SUBSCRIPTION_PLAN_COLLECTION).doc(planId);
}

function usageRef(planId: string) {
  return adminDb.collection(SUBSCRIPTION_PLAN_USAGE_COLLECTION).doc(planId);
}

function validPlanId(value: unknown): string {
  if (!isSubscriptionPlanId(value)) throw new ApiError('INVALID_REQUEST', 'planId must contain lowercase letters, numbers, and underscores only.', 400);
  return value;
}

function withSource(plan: SubscriptionPlan, source: 'persisted' | 'default'): SubscriptionPlan & { source: 'persisted' | 'default' } {
  return { ...plan, source };
}

function planFromSnapshot(planId: string, data?: Record<string, unknown>, allowDefault = true): SubscriptionPlan | null {
  if (data) return parseSubscriptionPlan(planId, data);
  return allowDefault ? defaultSubscriptionPlan(planId) : null;
}

function timestampMillis(value: unknown): number | undefined {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function isEligibleCanonicalSubscriptionLicense(data: Record<string, unknown>, planId: string, now = Date.now()) {
  const canonical = parseCanonicalLicense(data);
  if (canonical?.planId !== planId || !subscriptionStatusIsEligible(canonical.subscriptionStatus)) return false;
  const end = canonical.subscriptionStatus === 'trialing'
    ? timestampMillis(canonical.trialEndsAt)
    : timestampMillis(canonical.subscriptionEndsAt);
  return end === undefined || end > now;
}

async function usageView(plan: SubscriptionPlan, data?: Record<string, unknown>): Promise<SubscriptionPlanUsage> {
  const count = data && typeof data.eligibleCustomerCount === 'number' && Number.isInteger(data.eligibleCustomerCount)
    ? data.eligibleCustomerCount
    : 0;
  return buildSubscriptionPlanUsage(plan, count, data?.updatedAt);
}

/**
 * Console and public-signup read models use the same fail-closed allocation
 * view as the transaction: a stale low counter cannot make a capped offer look
 * available. The canonical scan is limited to the capped Founding product.
 */
async function allocationUsageView(
  plan: SubscriptionPlan,
  data?: Record<string, unknown>,
  canonicalDocuments?: QueryDocumentSnapshot[],
): Promise<SubscriptionPlanUsage> {
  const stored = await usageView(plan, data);
  if (subscriptionPlanCustomerLimit(plan) === null) return stored;
  const planCanonicalDocuments = canonicalDocuments === undefined
    ? await listCanonicalLicenseDocumentsForPlan(plan.planId)
    : canonicalDocuments.filter((document) => document.data().planId === plan.planId);
  const canonicalEligibleCustomerCount = planCanonicalDocuments
    .filter((document) => isEligibleCanonicalSubscriptionLicense(document.data(), plan.planId))
    .length;
  return buildSubscriptionPlanUsage(
    plan,
    Math.max(stored.eligibleCustomerCount, canonicalEligibleCustomerCount),
    stored.updatedAt,
  );
}

function storedEligibleCustomerCount(data?: Record<string, unknown>) {
  const value = data?.eligibleCustomerCount;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export async function getSubscriptionPlan(planId: string): Promise<SubscriptionPlan | null> {
  const id = validPlanId(planId);
  const snapshot = await planRef(id).get();
  if (!snapshot.exists) return defaultSubscriptionPlan(id);
  const plan = planFromSnapshot(id, snapshot.data() || {}, false);
  if (!plan) throw new ApiError('CONFLICT', `The ${id} subscription plan is invalid and requires attention.`, 409);
  return withSource(plan, 'persisted') as SubscriptionPlan;
}

/**
 * Lists the trusted commercial catalog. A caller that has already performed a
 * canonical-license scan may pass those documents to avoid repeating the
 * Founding allocation scan. The optional argument never changes the returned
 * catalog or the allocation policy.
 */
export async function listSubscriptionPlans(canonicalDocuments?: QueryDocumentSnapshot[]): Promise<SubscriptionPlanListItem[]> {
  const snapshot = await adminDb.collection(SUBSCRIPTION_PLAN_COLLECTION).get();
  const byId = new Map(snapshot.docs.map((item) => [item.id, item.data()]));
  const ids = [...new Set([...SUBSCRIPTION_PLAN_IDS, ...snapshot.docs.map((item) => item.id)])];
  const plans = ids.flatMap((planId) => {
    const plan = planFromSnapshot(planId, byId.get(planId), true);
    if (byId.has(planId) && !plan) throw new ApiError('CONFLICT', `The ${planId} subscription plan is invalid and requires attention.`, 409);
    if (!plan) return [];
    return [withSource(plan, byId.has(planId) ? 'persisted' : 'default')];
  });
  const usages = await Promise.all(plans.map(async (plan) => allocationUsageView(
    plan,
    (await usageRef(plan.planId).get()).data(),
    canonicalDocuments,
  )));
  return plans.map((plan, index) => ({
    ...(jsonSafe(plan) as SubscriptionPlanListItem),
    usage: jsonSafe(usages[index]) as SubscriptionPlanUsage,
  }));
}

export async function inspectSubscriptionPlanCatalog(): Promise<SubscriptionPlanCatalogInspection> {
  const snapshot = await adminDb.collection(SUBSCRIPTION_PLAN_COLLECTION).get();
  const byId = new Map(snapshot.docs.map((item) => [item.id, item.data()]));
  const missingPlanIds = SUBSCRIPTION_PLAN_IDS.filter((planId) => !byId.has(planId));
  const invalidPlanIds = snapshot.docs
    .filter((item) => !parseSubscriptionPlan(item.id, item.data() || {}))
    .map((item) => item.id)
    .sort();
  return {
    missingPlanIds,
    invalidPlanIds,
    available: missingPlanIds.length === 0 && invalidPlanIds.length === 0,
  };
}

async function publicSignupUsage(plan: SubscriptionPlan) {
  const storedUsage = await usageView(plan, (await usageRef(plan.planId).get()).data());
  if (subscriptionPlanCustomerLimit(plan) === null) return storedUsage;
  const comparison = await compareSubscriptionPlanUsage(plan.planId);
  return buildSubscriptionPlanUsage(
    plan,
    Math.max(storedUsage.eligibleCustomerCount, comparison.canonicalEligibleCustomerCount),
    storedUsage.updatedAt,
  );
}

export async function listPublicSignupPlans() {
  const plans = await listSubscriptionPlans();
  return plans
    .filter((plan) => plan.publicSignup && !plan.usage.isFull)
    .map((plan) => publicSubscriptionPlan(plan));
}

export async function getPublicSignupPlan(planId: string) {
  const plan = await getSubscriptionPlan(planId);
  if (!plan || !plan.publicSignup) return null;
  const usage = await publicSignupUsage(plan);
  if (usage.isFull) return null;
  return { plan, usage };
}

function booleanValue(value: unknown, field: string) {
  if (typeof value !== 'boolean') throw new ApiError('INVALID_REQUEST', `${field} must be a boolean.`, 400);
  return value;
}

function priceValue(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || Math.round(value * 100) !== value * 100) {
    throw new ApiError('INVALID_REQUEST', 'price must be a non-negative amount with at most two decimal places.', 400);
  }
  return value;
}

function validatePlanUpdate(planId: string, body: Record<string, unknown>, current: SubscriptionPlan) {
  const unsupported = Object.keys(body).filter((key) => !(PLAN_UPDATE_FIELDS as readonly string[]).includes(key));
  if (unsupported.length) throw new ApiError('INVALID_REQUEST', `Unsupported plan field: ${unsupported[0]}.`, 400);
  const next = { ...current } as SubscriptionPlan;
  if (body.displayName !== undefined) next.displayName = requiredString(body, 'displayName');
  if (body.price !== undefined) next.price = priceValue(body.price);
  if (body.currency !== undefined) next.currency = enumValue(body.currency, 'currency', ['USD'] as const);
  if (body.billingInterval !== undefined) next.billingInterval = enumValue(body.billingInterval, 'billingInterval', SUBSCRIPTION_BILLING_INTERVALS);
  if (body.trialDays !== undefined) next.trialDays = integer(body.trialDays, 'trialDays', 1);
  if (body.noCreditCardRequired !== undefined) next.noCreditCardRequired = booleanValue(body.noCreditCardRequired, 'noCreditCardRequired');
  if (body.publicSignup !== undefined) next.publicSignup = booleanValue(body.publicSignup, 'publicSignup');
  if (next.trialDays > 365) throw new ApiError('INVALID_REQUEST', 'trialDays cannot exceed 365 days.', 400);
  return next;
}

export async function updateSubscriptionPlan(planId: string, body: Record<string, unknown>, actor: AuthenticatedPlatformAdmin) {
  const id = validPlanId(planId);
  const ref = planRef(id);
  const counter = usageRef(id);
  const auditRef = adminDb.collection('platformAuditLogs').doc();
  return adminDb.runTransaction(async (transaction) => {
    const [planSnapshot, usageSnapshot] = await Promise.all([transaction.get(ref), transaction.get(counter)]);
    const current = planFromSnapshot(id, planSnapshot.exists ? planSnapshot.data() || {} : undefined, true);
    if (!current) throw new ApiError('CONFLICT', `The ${id} subscription plan is invalid and requires attention.`, 409);
    const next = validatePlanUpdate(id, body, current);
    let usageCount = usageSnapshot.exists && typeof usageSnapshot.data()?.eligibleCustomerCount === 'number'
      ? usageSnapshot.data()?.eligibleCustomerCount as number
      : 0;
    if (!usageSnapshot.exists && subscriptionPlanCustomerLimit(next) !== null) {
      const existing = await listCanonicalLicenseDocumentsForPlanInTransaction(transaction, id);
      usageCount = existing.filter((item) => isEligibleCanonicalSubscriptionLicense(item.data(), id)).length;
    }
    if (subscriptionPlanCustomerLimit(next) !== null && subscriptionPlanCustomerLimit(next)! < usageCount) {
      throw new ApiError('CONFLICT', `The configured customer limit cannot be lower than the current eligible customer count of ${usageCount}.`, 409);
    }
    const now = Timestamp.now();
    const nextData = {
      ...next,
      createdAt: current.createdAt || now,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    };
    const responseData = { ...next, createdAt: current.createdAt || now, updatedAt: now, updatedBy: actor.uid };
    transaction.set(ref, omitUndefined(nextData), { merge: true });
    transaction.set(auditRef, {
      action: 'SUBSCRIPTION_PLAN_UPDATED',
      actorUid: actor.uid,
      actorRole: actor.role,
      targetType: 'SUBSCRIPTION_PLAN',
      targetId: id,
      metadata: {
        changedFields: Object.keys(body),
        publicSignupChanged: body.publicSignup !== undefined,
        previousPublicSignup: body.publicSignup !== undefined ? current.publicSignup : null,
        nextPublicSignup: body.publicSignup !== undefined ? next.publicSignup : null,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
    return { plan: jsonSafe(responseData), usage: jsonSafe(buildSubscriptionPlanUsage(next, usageCount, now)), auditLogId: auditRef.id };
  });
}

function foundingLimitFromRequest(body: Record<string, unknown>) {
  const unsupported = Object.keys(body).find((key) => !(FOUNDING_CAPACITY_UPDATE_FIELDS as readonly string[]).includes(key));
  if (unsupported) throw new ApiError('INVALID_REQUEST', `Unsupported Founding capacity field: ${unsupported}.`, 400);
  if (!Object.prototype.hasOwnProperty.call(body, 'foundingLimit')) {
    throw new ApiError('INVALID_REQUEST', 'foundingLimit is required.', 400);
  }
  const value = integer(body.foundingLimit, 'foundingLimit', 1);
  if (value > MAX_FOUNDING_CUSTOMER_LIMIT) {
    throw new ApiError('INVALID_REQUEST', `foundingLimit cannot exceed ${MAX_FOUNDING_CUSTOMER_LIMIT}.`, 400);
  }
  return value;
}

/**
 * Narrow, SUPER_ADMIN-routed mutation for the capped Founding offer. The
 * product code, entitlement mapping, current licenses, pricing snapshots, and
 * stored allocation counter are deliberately not mutable through this path.
 */
export async function updateFoundingCustomerLimit(body: Record<string, unknown>, actor: AuthenticatedPlatformAdmin) {
  const foundingLimit = foundingLimitFromRequest(body);
  const id = 'founding_100';
  const ref = planRef(id);
  const counter = usageRef(id);
  const auditRef = adminDb.collection('platformAuditLogs').doc();

  return adminDb.runTransaction(async (transaction) => {
    const [planSnapshot, usageSnapshot] = await Promise.all([transaction.get(ref), transaction.get(counter)]);
    if (!planSnapshot.exists) {
      throw new ApiError('CONFLICT', 'Initialize the plan catalog before changing the Founding customer limit.', 409);
    }
    const current = planFromSnapshot(id, planSnapshot.data() || {}, false);
    if (!current) throw new ApiError('CONFLICT', 'The founding_100 subscription plan is invalid and requires attention.', 409);

    // Count canonical eligible licenses inside the same transaction. The
    // counter remains a fast-path guard, but canonical state is the authority
    // for whether a lower configured limit would strand existing customers.
    const canonicalDocuments = await listCanonicalLicenseDocumentsForPlanInTransaction(transaction, id);
    const canonicalEligibleCustomerCount = canonicalDocuments
      .filter((document) => isEligibleCanonicalSubscriptionLicense(document.data(), id))
      .length;
    if (foundingLimit < canonicalEligibleCustomerCount) {
      throw new ApiError(
        'FOUNDING_LIMIT_BELOW_USAGE',
        'The Founding customer limit cannot be lower than the current canonical eligible-customer count.',
        409,
      );
    }

    const storedCount = storedEligibleCustomerCount(usageSnapshot.exists ? usageSnapshot.data() || {} : undefined);
    const allocationCount = Math.max(storedCount, canonicalEligibleCustomerCount);
    const now = Timestamp.now();
    if (current.foundingLimit === foundingLimit) {
      return {
        changed: false,
        plan: jsonSafe({ ...current, updatedAt: current.updatedAt || now }),
        usage: jsonSafe(buildSubscriptionPlanUsage(current, allocationCount, usageSnapshot.data()?.updatedAt)),
        canonicalEligibleCustomerCount,
        auditLogId: null,
      };
    }

    const next: SubscriptionPlan = {
      ...current,
      foundingLimit,
      // Keep the established Console projection in sync atomically. Runtime
      // allocation uses `foundingLimit`, not this compatibility field.
      maxEligibleCustomers: foundingLimit,
      updatedAt: now,
      updatedBy: actor.uid,
    };
    transaction.update(ref, {
      foundingLimit,
      maxEligibleCustomers: foundingLimit,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    });
    transaction.set(auditRef, {
      action: 'FOUNDING_LIMIT_UPDATED',
      actorUid: actor.uid,
      actorRole: actor.role,
      targetType: 'SUBSCRIPTION_PLAN',
      targetId: id,
      metadata: {
        previousLimit: current.foundingLimit,
        newLimit: foundingLimit,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
    return {
      changed: true,
      plan: jsonSafe(next),
      usage: jsonSafe(buildSubscriptionPlanUsage(next, allocationCount, usageSnapshot.data()?.updatedAt)),
      canonicalEligibleCustomerCount,
      auditLogId: auditRef.id,
    };
  });
}

function expectedMarketingRevision(body: Record<string, unknown>) {
  if (body.expectedRevision === undefined) return undefined;
  return integer(body.expectedRevision, 'expectedRevision', 0);
}

function rejectUnsupportedMarketingFields(body: Record<string, unknown>, allowed: readonly string[]) {
  const unsupported = Object.keys(body).find((key) => !allowed.includes(key));
  if (unsupported) throw new ApiError('INVALID_REQUEST', `Unsupported marketing field: ${unsupported}.`, 400);
}

function marketingValue(body: Record<string, unknown>): SubscriptionPlanMarketing {
  if (!Object.prototype.hasOwnProperty.call(body, 'marketing')) throw new ApiError('INVALID_REQUEST', 'marketing is required.', 400);
  const marketing = parseSubscriptionPlanMarketing(body.marketing);
  if (!marketing) {
    throw new ApiError('INVALID_REQUEST', 'marketing must contain one to three plain-text messages and an optional plain-text badge.', 400);
  }
  return marketing;
}

function assertMarketingRevision(current: SubscriptionPlan, expectedRevision: number | undefined) {
  if (expectedRevision !== undefined && expectedRevision !== current.marketingRevision) {
    throw new ApiError('CONFLICT', 'Plan marketing changed by another administrator. Refresh and try again.', 409);
  }
}

function marketingResult(plan: SubscriptionPlan, revision: number, updatedAt: Timestamp, updatedByUid: string) {
  return {
    planId: plan.planId,
    marketing: plan.marketing ? { ...(plan.marketing.badge ? { badge: plan.marketing.badge } : {}), messages: [...plan.marketing.messages] } : null,
    marketingRevision: revision,
    marketingUpdatedAt: updatedAt.toDate().toISOString(),
    marketingUpdatedByUid: updatedByUid,
  };
}

/**
 * Narrow, SUPER_ADMIN-routed mutation for public display copy only. It never
 * accepts or writes commercial authority, entitlement, availability, or
 * provisioning values.
 */
export async function updateSubscriptionPlanMarketing(planId: string, body: Record<string, unknown>, actor: AuthenticatedPlatformAdmin) {
  const id = validPlanId(planId);
  rejectUnsupportedMarketingFields(body, PLAN_MARKETING_UPDATE_FIELDS);
  const marketing = marketingValue(body);
  const expectedRevision = expectedMarketingRevision(body);
  const ref = planRef(id);
  const auditRef = adminDb.collection('platformAuditLogs').doc();
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new ApiError('CONFLICT', 'Initialize the plan catalog before editing plan marketing.', 409);
    const current = planFromSnapshot(id, snapshot.data() || {}, false);
    if (!current) throw new ApiError('CONFLICT', `The ${id} subscription plan is invalid and requires attention.`, 409);
    assertMarketingRevision(current, expectedRevision);
    const now = Timestamp.now();
    const nextRevision = current.marketingRevision + 1;
    const next = { ...current, marketing, marketingRevision: nextRevision, marketingUpdatedAt: now, marketingUpdatedByUid: actor.uid };
    // update() replaces the top-level marketing map. A merge write would keep
    // an old badge when the new valid configuration deliberately omits one.
    transaction.update(ref, {
      marketing,
      marketingRevision: nextRevision,
      marketingUpdatedAt: FieldValue.serverTimestamp(),
      marketingUpdatedByUid: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    });
    transaction.set(auditRef, {
      action: 'SUBSCRIPTION_PLAN_MARKETING_UPDATED',
      actorUid: actor.uid,
      actorRole: actor.role,
      targetType: 'SUBSCRIPTION_PLAN',
      targetId: id,
      metadata: { marketingChanged: true, marketingAction: 'UPDATED', marketingRevision: nextRevision },
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ...marketingResult(next, nextRevision, now, actor.uid), auditLogId: auditRef.id };
  });
}

/** An explicit clear stores a private null marker so default copy is not restored. */
export async function clearSubscriptionPlanMarketing(planId: string, body: Record<string, unknown>, actor: AuthenticatedPlatformAdmin) {
  const id = validPlanId(planId);
  rejectUnsupportedMarketingFields(body, PLAN_MARKETING_CLEAR_FIELDS);
  const expectedRevision = expectedMarketingRevision(body);
  const ref = planRef(id);
  const auditRef = adminDb.collection('platformAuditLogs').doc();
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new ApiError('CONFLICT', 'Initialize the plan catalog before editing plan marketing.', 409);
    const current = planFromSnapshot(id, snapshot.data() || {}, false);
    if (!current) throw new ApiError('CONFLICT', `The ${id} subscription plan is invalid and requires attention.`, 409);
    assertMarketingRevision(current, expectedRevision);
    const now = Timestamp.now();
    const nextRevision = current.marketingRevision + 1;
    transaction.update(ref, {
      marketing: null,
      marketingRevision: nextRevision,
      marketingUpdatedAt: FieldValue.serverTimestamp(),
      marketingUpdatedByUid: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    });
    transaction.set(auditRef, {
      action: 'SUBSCRIPTION_PLAN_MARKETING_CLEARED',
      actorUid: actor.uid,
      actorRole: actor.role,
      targetType: 'SUBSCRIPTION_PLAN',
      targetId: id,
      metadata: { marketingChanged: true, marketingAction: 'CLEARED', marketingRevision: nextRevision },
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ...marketingResult({ ...current, marketing: undefined }, nextRevision, now, actor.uid), auditLogId: auditRef.id };
  });
}

export async function bootstrapDefaultSubscriptionPlans(actor: AuthenticatedPlatformAdmin | { uid: string; email: string; role: string }) {
  const auditRef = adminDb.collection('platformAuditLogs').doc();
  return adminDb.runTransaction(async (transaction) => {
    const refs = Object.keys(DEFAULT_SUBSCRIPTION_PLANS).map((planId) => planRef(planId));
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    const created: string[] = [];
    const backfilledFoundingLimitPlanIds: string[] = [];
    const now = Timestamp.now();
    snapshots.forEach((snapshot, index) => {
      const planId = Object.keys(DEFAULT_SUBSCRIPTION_PLANS)[index];
      if (snapshot.exists) {
        // This is an explicit, operator-triggered compatibility backfill. A
        // normal read keeps old documents working without modifying them.
        if (planId === 'founding_100' && !Object.prototype.hasOwnProperty.call(snapshot.data() || {}, 'foundingLimit')) {
          const existing = planFromSnapshot(planId, snapshot.data() || {}, false);
          if (existing) {
            transaction.update(refs[index], {
              foundingLimit: existing.foundingLimit,
              maxEligibleCustomers: existing.maxEligibleCustomers,
              updatedAt: FieldValue.serverTimestamp(),
              updatedBy: actor.uid,
            });
            backfilledFoundingLimitPlanIds.push(planId);
          }
        }
        return;
      }
      transaction.set(refs[index], { ...DEFAULT_SUBSCRIPTION_PLANS[planId], createdAt: now, updatedAt: now, updatedBy: actor.uid });
      created.push(planId);
    });
    if (created.length || backfilledFoundingLimitPlanIds.length) transaction.set(auditRef, {
      action: 'SUBSCRIPTION_PLANS_BOOTSTRAPPED',
      actorUid: actor.uid,
      actorRole: actor.role,
      targetType: 'SUBSCRIPTION_PLAN_CATALOG',
      targetId: 'platformPlans',
      metadata: { createdPlanIds: created, backfilledFoundingLimitPlanIds },
      createdAt: FieldValue.serverTimestamp(),
    });
    return {
      created,
      backfilledFoundingLimitPlanIds,
      plans: Object.values(DEFAULT_SUBSCRIPTION_PLANS).map((plan) => ({ ...plan, source: created.includes(plan.planId) ? 'created' : 'existing' })),
    };
  });
}

/**
 * Rebuilds the allocation counter from license documents. This is an explicit
 * operator action/maintenance primitive, not part of a client request.
 */
export async function reconcileSubscriptionPlanUsage(planId: string) {
  const comparison = await compareSubscriptionPlanUsage(planId);
  const plan = await getSubscriptionPlan(planId);
  if (!plan) throw new ApiError('NOT_FOUND', 'Subscription plan not found.', 404);
  const now = Timestamp.now();
  await usageRef(plan.planId).set({ ...buildSubscriptionPlanUsage(plan, comparison.canonicalEligibleCustomerCount, now), updatedAt: now }, { merge: true });
  return buildSubscriptionPlanUsage(plan, comparison.canonicalEligibleCustomerCount, now);
}

/**
 * Read-only allocation check. This is safe to run against production because
 * it never writes a counter or a license. The write-capable reconciliation
 * above remains an explicit operator-only maintenance primitive and has no API
 * route.
 */
export async function compareSubscriptionPlanUsage(planId: string, canonicalDocuments?: QueryDocumentSnapshot[]) {
  const plan = await getSubscriptionPlan(planId);
  if (!plan) throw new ApiError('NOT_FOUND', 'Subscription plan not found.', 404);
  const [usageSnapshot, licenseDocuments] = await Promise.all([
    usageRef(plan.planId).get(),
    canonicalDocuments === undefined
      ? listCanonicalLicenseDocumentsForPlan(plan.planId)
      : Promise.resolve(canonicalDocuments.filter((document) => document.data().planId === plan.planId)),
  ]);
  const canonicalEligibleCustomerCount = licenseDocuments.filter((item) => isEligibleCanonicalSubscriptionLicense(item.data(), plan.planId)).length;
  const storedEligibleCustomerCount = usageSnapshot.exists && typeof usageSnapshot.data()?.eligibleCustomerCount === 'number'
    ? usageSnapshot.data()?.eligibleCustomerCount as number
    : 0;
  return {
    planId: plan.planId,
    storedEligibleCustomerCount,
    canonicalEligibleCustomerCount,
    difference: storedEligibleCustomerCount - canonicalEligibleCustomerCount,
    matches: storedEligibleCustomerCount === canonicalEligibleCustomerCount,
    counterExists: usageSnapshot.exists,
    limit: subscriptionPlanCustomerLimit(plan),
  };
}

/** Safe, read-only convenience function for the launch-limited plan. */
export const compareFounding100Usage = (canonicalDocuments?: QueryDocumentSnapshot[]) => compareSubscriptionPlanUsage('founding_100', canonicalDocuments);

export async function readSubscriptionPlanUsage(planId: string) {
  const plan = await getSubscriptionPlan(planId);
  if (!plan) return null;
  return usageView(plan, (await usageRef(plan.planId).get()).data());
}
