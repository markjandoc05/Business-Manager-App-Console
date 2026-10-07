import { FieldValue, Timestamp, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin-core';
import { listCanonicalLicenseDocumentsForPlan, listCanonicalLicenseDocumentsForPlanInTransaction } from './canonical-license-query';
import { ApiError } from './api-errors';
import { validateOrganizationId } from './request';
import type { AuthenticatedClientUser, AuthenticatedOrganizationMember } from './client-organization-auth';
import { assertActiveClientProfile } from './client-organization-auth';
import {
  SUBSCRIPTION_PLAN_COLLECTION,
  SUBSCRIPTION_PLAN_USAGE_COLLECTION,
  buildSubscriptionPlanUsage,
  defaultSubscriptionPlan,
  isEligibleSubscriptionStatus,
  isSubscriptionPlanId,
  parseSubscriptionPlan,
  publicSubscriptionPlan,
  subscriptionPlanCustomerLimit,
  subscriptionStatusIsEligible,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from '../subscription-plan-contract';
import { applicableLicenseExpiration, buildOrganizationLicenseMirror, LICENSE_PLAN_CONFIG, parseCanonicalLicense, resolveCanonicalLicense } from '../license-contract';
import { commercialProductEntitlement } from '../commercial-entitlement-contract';

const DAY_MS = 86_400_000;
const ONBOARDING_CURRENCIES = ['PHP', 'USD', 'AUD', 'SGD', 'EUR', 'GBP'] as const;
const DEFAULT_LICENSE_FEATURES = { crm: true, reports: true, documents: true };

/**
 * Trusted request-replay records for the versioned Client Platform API. These
 * are written in the same Firestore transaction as workspace provisioning so
 * a lost HTTP response can never cause a second workspace or Founding claim.
 */
export const CLIENT_PROVISIONING_IDEMPOTENCY_COLLECTION = 'platformProvisioningIdempotency';

export interface SubscriptionProvisioningIdempotency {
  reference: DocumentReference;
  endpoint: 'POST /api/v1/trials';
  uid: string;
  requestFingerprint: string;
  retentionUntil: Timestamp;
}

export interface SubscriptionProvisioningResult {
  workspaceId: string;
  organizationId: string;
  plan: ReturnType<typeof publicSubscriptionPlan> | null;
  license: Record<string, unknown>;
  auditLogId: string | null;
  idempotent: boolean;
  legacy?: boolean;
}

function timestampMillis(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().getTime();
  return undefined;
}

function timestampValue(value: unknown) {
  return value instanceof Timestamp ? value : undefined;
}

function jsonSafe(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}

/** Removes undefined values before a result is persisted in Firestore. */
function firestoreSafe(value: unknown): unknown {
  if (value instanceof Timestamp || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item) => firestoreSafe(item) ?? null);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const safeItem = firestoreSafe(item);
      if (safeItem !== undefined) result[key] = safeItem;
    }
    return result;
  }
  return value;
}

function planRef(planId: string) {
  return adminDb.collection(SUBSCRIPTION_PLAN_COLLECTION).doc(planId);
}

function usageRef(planId: string) {
  return adminDb.collection(SUBSCRIPTION_PLAN_USAGE_COLLECTION).doc(planId);
}

function effectiveSubscriptionStatus(data: Record<string, unknown>, now = Date.now()): SubscriptionStatus | null {
  if (!isEligibleSubscriptionStatus(data.subscriptionStatus)) return null;
  const status = data.subscriptionStatus;
  const end = status === 'trialing' ? timestampMillis(data.trialEndsAt) : timestampMillis(data.subscriptionEndsAt);
  if ((status === 'trialing' || status === 'active') && end !== undefined && now > end) return 'expired';
  return status;
}

function entitlementForPlan(plan: SubscriptionPlan) {
  const entitlement = commercialProductEntitlement(plan.planId);
  if (!entitlement || entitlement.entitlementTier !== plan.entitlementTier) {
    throw new ApiError('CONFLICT', `The ${plan.planId} commercial entitlement mapping is invalid and requires attention.`, 409);
  }
  return {
    entitlementTier: entitlement.entitlementTier,
    maxUsers: LICENSE_PLAN_CONFIG[entitlement.entitlementTier].maxUsers,
    storageLimitBytes: entitlement.storageLimitBytes,
  };
}

function legacySubscriptionStatus(data: Record<string, unknown>, now: number): SubscriptionStatus | null {
  const canonical = parseCanonicalLicense(data);
  if (!canonical) return null;
  const resolved = resolveCanonicalLicense(canonical, now).status;
  if (resolved === 'TRIAL') return 'trialing';
  if (resolved === 'ACTIVE') return 'active';
  if (resolved === 'EXPIRED') return 'expired';
  if (resolved === 'SUSPENDED') return 'cancelled';
  return null;
}

function licenseView(data: Record<string, unknown> | undefined, now = Date.now()) {
  if (!data) return null;
  const canonical = parseCanonicalLicense(data);
  if (!canonical) return null;
  const status = effectiveSubscriptionStatus(data, now) || legacySubscriptionStatus(data, now);
  if (!status) return null;
  return {
    organizationId: canonical.organizationId,
    planId: canonical.planId,
    status,
    trialStartedAt: jsonSafe(data.trialStartedAt),
    trialEndsAt: jsonSafe(data.trialEndsAt),
    subscriptionStartedAt: jsonSafe(data.subscriptionStartedAt),
    renewalDate: jsonSafe(data.renewalDate),
    subscriptionEndsAt: jsonSafe(data.subscriptionEndsAt),
    priceAtSubscription: typeof data.priceAtSubscription === 'number' ? data.priceAtSubscription : null,
    currency: typeof data.currency === 'string' ? data.currency : undefined,
    billingInterval: data.billingInterval,
    createdAt: jsonSafe(data.createdAt),
    updatedAt: jsonSafe(data.updatedAt),
  };
}

function validStoredOrganizationId(value: unknown) {
  try { return validateOrganizationId(value); } catch { return null; }
}

function storedProvisioningResult(value: unknown): SubscriptionProvisioningResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const organizationId = validStoredOrganizationId(result.organizationId);
  const workspaceId = validStoredOrganizationId(result.workspaceId);
  if (!organizationId || !workspaceId || organizationId !== workspaceId || !result.license || typeof result.license !== 'object' || Array.isArray(result.license)) return null;
  if (result.plan !== null && (!result.plan || typeof result.plan !== 'object' || Array.isArray(result.plan))) return null;
  return {
    workspaceId,
    organizationId,
    plan: result.plan as ReturnType<typeof publicSubscriptionPlan> | null,
    license: result.license as Record<string, unknown>,
    auditLogId: typeof result.auditLogId === 'string' ? result.auditLogId : null,
    idempotent: true,
    legacy: result.legacy === true,
  };
}

function idempotencyReplayResult(
  snapshot: { exists: boolean; data(): Record<string, unknown> | undefined },
  idempotency: SubscriptionProvisioningIdempotency | undefined,
) {
  if (!idempotency || !snapshot.exists) return null;
  const record = snapshot.data() || {};
  if (record.endpoint !== idempotency.endpoint || record.uid !== idempotency.uid || record.requestFingerprint !== idempotency.requestFingerprint || record.status !== 'COMPLETED') {
    throw new ApiError('IDEMPOTENCY_CONFLICT', 'The idempotency key has already been used for a different request.', 409);
  }
  const result = storedProvisioningResult(record.result);
  if (!result) throw new ApiError('IDEMPOTENCY_CONFLICT', 'The idempotency key cannot be replayed safely.', 409);
  return result;
}

function completeIdempotencyRecord(
  transaction: Transaction,
  idempotency: SubscriptionProvisioningIdempotency | undefined,
  result: SubscriptionProvisioningResult,
) {
  if (!idempotency) return;
  transaction.set(idempotency.reference, {
    schemaVersion: 1,
    endpoint: idempotency.endpoint,
    uid: idempotency.uid,
    requestFingerprint: idempotency.requestFingerprint,
    status: 'COMPLETED',
    result: firestoreSafe(result),
    createdAt: FieldValue.serverTimestamp(),
    completedAt: FieldValue.serverTimestamp(),
    retentionUntil: idempotency.retentionUntil,
  });
}

function idempotentTrialResult(
  organizationId: string,
  plan: SubscriptionPlan,
  current: Record<string, unknown> | undefined,
  now: number,
) {
  const canonical = current ? parseCanonicalLicense(current) : null;
  const existingLicense = licenseView(current, now);
  // A retry is only idempotent for the same platform plan. A request for a
  // different plan remains a no-write conflict below rather than silently
  // presenting a different commercial offer as the selected one.
  if (!canonical || canonical.planId !== plan.planId || !existingLicense || existingLicense.planId !== plan.planId) return null;
  if (canonical.entitlementTier !== undefined && canonical.entitlementTier !== plan.entitlementTier) return null;
  return {
    organizationId,
    plan: publicSubscriptionPlan(plan),
    license: existingLicense,
    auditLogId: null,
    idempotent: true,
  };
}

/**
 * V1 licenses have no commercial `planId`. They remain canonical Client
 * licenses, so a valid current V1 trial or subscription is returned without a
 * write instead of being relabeled as a new commercial product.
 */
function existingLegacyLicenseResult(organizationId: string, current: Record<string, unknown> | undefined, now: number) {
  const canonical = current ? parseCanonicalLicense(current) : null;
  if (!canonical || canonical.planId !== undefined) return null;
  const resolved = resolveCanonicalLicense(canonical, now).status;
  if (resolved !== 'TRIAL' && resolved !== 'ACTIVE') return null;
  const license = licenseView(current, now);
  if (!license) return null;
  return {
    organizationId,
    plan: null,
    license,
    auditLogId: null,
    idempotent: true,
    legacy: true,
  };
}

async function existingProvisioningResult(
  transaction: Transaction,
  organizationId: string,
  user: AuthenticatedClientUser,
  plan: SubscriptionPlan,
  now: number,
) {
  const organizationRef = adminDb.collection('organizations').doc(organizationId);
  const memberRef = organizationRef.collection('members').doc(user.uid);
  const licenseRef = organizationRef.collection('license').doc('current');
  const [organizationSnapshot, memberSnapshot, licenseSnapshot] = await Promise.all([
    transaction.get(organizationRef),
    transaction.get(memberRef),
    transaction.get(licenseRef),
  ]);
  const member = memberSnapshot.data() || {};
  const current = licenseSnapshot.exists ? licenseSnapshot.data() || {} : undefined;
  if (!organizationSnapshot.exists
    || !memberSnapshot.exists
    || member.status?.toString().toLowerCase() !== 'active'
    || member.role !== 'ADMIN') {
    throw new ApiError('WORKSPACE_ALREADY_EXISTS', 'This account already has a workspace that requires support review.', 409);
  }

  const legacy = existingLegacyLicenseResult(organizationId, current, now);
  if (legacy) {
    return {
      workspaceId: organizationId,
      organizationId,
      plan: null,
      license: legacy.license,
      auditLogId: null,
      idempotent: true,
      legacy: true,
    };
  }

  const existing = idempotentTrialResult(organizationId, plan, current, now);
  if (!existing) {
    const canonical = current ? parseCanonicalLicense(current) : null;
    const currentStatus = canonical ? resolveCanonicalLicense(canonical, now).status : 'UNKNOWN';
    if (currentStatus === 'TRIAL' || currentStatus === 'ACTIVE') {
      throw new ApiError('TRIAL_ALREADY_EXISTS', 'This account already has a current trial or subscription.', 409);
    }
    throw new ApiError('WORKSPACE_ALREADY_EXISTS', 'This account already has a workspace that requires support review.', 409);
  }
  return {
    workspaceId: organizationId,
    organizationId,
    plan: existing.plan,
    license: { ...existing.license, planCode: plan.code, planName: plan.displayName },
    auditLogId: null,
    idempotent: true,
  };
}

function planFromSnapshot(planId: string, exists: boolean, data?: Record<string, unknown>): SubscriptionPlan | null {
  if (exists) return parseSubscriptionPlan(planId, data || {});
  return defaultSubscriptionPlan(planId);
}

function isEligibleCanonicalSubscriptionLicense(data: Record<string, unknown>, planId: string, now = Date.now()) {
  const canonical = parseCanonicalLicense(data);
  return canonical?.planId === planId
    && subscriptionStatusIsEligible(effectiveSubscriptionStatus(data, now));
}

function workspaceField(workspace: Record<string, unknown>, field: string, required = true) {
  const value = workspace[field];
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > 200) throw new ApiError('INVALID_REQUEST', `${field} must be a valid workspace value.`, 400);
  return value.trim();
}

function normalizeWorkspaceSlug(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  if (!slug) throw new ApiError('INVALID_REQUEST', 'workspace.name must produce a valid workspace slug.', 400);
  return slug;
}

function requestedWorkspaceSlug(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ApiError('INVALID_REQUEST', 'workspace.requestedSlug must be a valid workspace slug.', 400);
  const slug = value.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 64) {
    throw new ApiError('INVALID_REQUEST', 'workspace.requestedSlug must be a lowercase workspace slug.', 400);
  }
  return slug;
}

function validateWorkspaceInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST', 'workspace is required.', 400);
  const workspace = value as Record<string, unknown>;
  const allowedWorkspaceFields = ['name', 'requestedSlug', 'businessType', 'phone', 'website', 'currency', 'timezone'];
  const unsupported = Object.keys(workspace).find((field) => !allowedWorkspaceFields.includes(field));
  if (unsupported) throw new ApiError('INVALID_REQUEST', `Unsupported workspace field: ${unsupported}.`, 400);
  const name = workspaceField(workspace, 'name');
  const businessType = workspaceField(workspace, 'businessType');
  const phone = workspaceField(workspace, 'phone', false);
  const website = workspaceField(workspace, 'website', false);
  const currency = workspaceField(workspace, 'currency');
  const timezone = workspaceField(workspace, 'timezone');
  const slug = requestedWorkspaceSlug(workspace.requestedSlug) || normalizeWorkspaceSlug(name);
  if (!(ONBOARDING_CURRENCIES as readonly string[]).includes(currency)) throw new ApiError('INVALID_REQUEST', 'workspace.currency is not supported.', 400);
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); } catch { throw new ApiError('INVALID_REQUEST', 'workspace.timezone must be a valid IANA timezone.', 400); }
  return { name, businessType, phone, website, currency, timezone, slug };
}

async function countEligibleLicensesInTransaction(transaction: Transaction, planId: string, now = Date.now()) {
  const licenses = await listCanonicalLicenseDocumentsForPlanInTransaction(transaction, planId);
  return licenses.filter((item) => isEligibleCanonicalSubscriptionLicense(item.data(), planId, now)).length;
}

function storedEligibleCustomerCount(data: Record<string, unknown> | undefined) {
  const value = data?.eligibleCustomerCount;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * The counter is the normal fast path, but a capped plan must never admit a
 * customer merely because that counter was manually damaged or is stale. For
 * Founding 100, use the higher of the transactional counter and canonical
 * license count. A high stale counter can only fail closed; a low counter can
 * never create customer 101.
 */
async function allocationCountInTransaction(
  transaction: Transaction,
  plan: SubscriptionPlan,
  counterData: Record<string, unknown> | undefined,
  now = Date.now(),
) {
  const storedCount = storedEligibleCustomerCount(counterData);
  if (subscriptionPlanCustomerLimit(plan) === null) {
    return storedCount ?? await countEligibleLicensesInTransaction(transaction, plan.planId, now);
  }
  const canonicalCount = await countEligibleLicensesInTransaction(transaction, plan.planId, now);
  return storedCount === undefined ? canonicalCount : Math.max(storedCount, canonicalCount);
}

function currentLicenseCanStartTrial(current: Record<string, unknown> | undefined, now: number) {
  if (!current) return { allowed: true, parsed: null };
  const parsed = parseCanonicalLicense(current);
  if (!parsed) return { allowed: false, parsed: null, reason: 'The organization has an invalid license. Repair it in the Developer Console before starting a new trial.' };
  const modernStatus = effectiveSubscriptionStatus(current, now);
  if (modernStatus === 'trialing' || modernStatus === 'active') return { allowed: false, parsed, reason: 'The organization already has a current trial or subscription.' };
  if (parsed.status === 'SUSPENDED' && modernStatus !== 'cancelled') return { allowed: false, parsed, reason: 'The organization has a suspended license.' };
  if (parsed.status === 'TRIAL' || parsed.status === 'ACTIVE') {
    const resolved = resolveCanonicalLicense(parsed, now);
    if (resolved.status === 'TRIAL' || resolved.status === 'ACTIVE') return { allowed: false, parsed, reason: 'The organization already has a current trial or subscription.' };
  }
  return { allowed: true, parsed };
}

export async function getCurrentSubscriptionLicense(organizationId: string) {
  const orgId = validateOrganizationId(organizationId);
  const snapshot = await adminDb.collection('organizations').doc(orgId).collection('license').doc('current').get();
  return { organizationId: orgId, license: licenseView(snapshot.exists ? snapshot.data() : undefined) };
}

/**
 * Client-facing canonical license projection. It intentionally exposes the
 * supported `license.plan` tier but not the server-only future entitlement
 * snapshot. Product identity is returned separately from Client authorization
 * data so commercial offers never become a browser authorization rule.
 */
export async function getClientPlatformSubscriptionStatus(organizationId: string) {
  const orgId = validateOrganizationId(organizationId);
  const snapshot = await adminDb.collection('organizations').doc(orgId).collection('license').doc('current').get();
  const data = snapshot.exists ? snapshot.data() || {} : undefined;
  const canonical = data ? parseCanonicalLicense(data) : null;
  if (!canonical) throw new ApiError('LICENSE_NOT_FOUND', 'No canonical license was found for this organization.', 404);
  const resolved = resolveCanonicalLicense(canonical);
  if (resolved.status === 'UNKNOWN') throw new ApiError('LICENSE_NOT_FOUND', 'No canonical license was found for this organization.', 404);
  const date = (value: unknown) => {
    const safe = jsonSafe(value);
    return typeof safe === 'string' ? safe : null;
  };
  return {
    workspaceId: orgId,
    organizationId: orgId,
    productCode: canonical.planId || null,
    legacy: canonical.planId === undefined,
    license: {
      plan: canonical.plan,
      status: resolved.status,
      trialStartedAt: date(canonical.trialStartedAt),
      trialEndsAt: date(canonical.trialEndsAt),
      subscriptionStartedAt: date(canonical.subscriptionStartedAt),
      renewalDate: date(canonical.renewalDate),
      expirationDate: date(applicableLicenseExpiration(canonical)),
      maxUsers: canonical.maxUsers,
      billingInterval: canonical.billingInterval === 'year' ? 'year' : null,
    },
  };
}

export async function validateSubscriptionEligibility(organizationId: string, planId: string) {
  const orgId = validateOrganizationId(organizationId);
  if (!isSubscriptionPlanId(planId)) throw new ApiError('INVALID_REQUEST', 'The requested subscription plan is invalid.', 400);
  const [organizationSnapshot, planSnapshot, usageSnapshot, licenseSnapshot] = await Promise.all([
    adminDb.collection('organizations').doc(orgId).get(),
    planRef(planId).get(),
    usageRef(planId).get(),
    adminDb.collection('organizations').doc(orgId).collection('license').doc('current').get(),
  ]);
  if (!organizationSnapshot.exists) throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
  const plan = planFromSnapshot(planId, planSnapshot.exists, planSnapshot.data());
  if (!plan) throw new ApiError('INVALID_REQUEST', 'The requested subscription plan is invalid.', 400);
  const counterData = usageSnapshot.exists ? usageSnapshot.data() || {} : undefined;
  let usageCount = storedEligibleCustomerCount(counterData) ?? 0;
  if (subscriptionPlanCustomerLimit(plan) !== null) {
    const existing = await listCanonicalLicenseDocumentsForPlan(plan.planId);
    const canonicalCount = existing.filter((item) => isEligibleCanonicalSubscriptionLicense(item.data(), plan.planId)).length;
    usageCount = Math.max(usageCount, canonicalCount);
  } else if (storedEligibleCustomerCount(counterData) === undefined) {
    const existing = await listCanonicalLicenseDocumentsForPlan(plan.planId);
    usageCount = existing.filter((item) => isEligibleCanonicalSubscriptionLicense(item.data(), plan.planId)).length;
  }
  const usage = buildSubscriptionPlanUsage(plan, usageCount, counterData?.updatedAt);
  const current = licenseSnapshot.exists ? licenseSnapshot.data() || {} : undefined;
  const existing = idempotentTrialResult(orgId, plan, current, Date.now());
  const existingLegacy = existingLegacyLicenseResult(orgId, current, Date.now());
  const currentState = currentLicenseCanStartTrial(current, Date.now());
  let eligible = true;
  let reason: string | undefined;
  if (!plan.publicSignup) { eligible = false; reason = 'This subscription plan is not currently available for public signup.'; }
  else if (usage.isFull) { eligible = false; reason = 'The Founding 100 customer limit has been reached.'; }
  else if (existing) { eligible = false; reason = 'This organization already has a license for this subscription plan.'; }
  else if (existingLegacy) { eligible = false; reason = 'This organization already has a valid legacy license. Its Client entitlement remains unchanged.'; }
  else if (!currentState.allowed) { eligible = false; reason = currentState.reason; }
  return { organizationId: orgId, plan: publicSubscriptionPlan(plan), usage, eligible, reason, idempotent: Boolean(existing || existingLegacy), legacy: Boolean(existingLegacy) };
}

export async function startSubscriptionTrial(
  organizationId: string,
  planId: string,
  actor: AuthenticatedOrganizationMember,
) {
  const orgId = validateOrganizationId(organizationId);
  if (!isSubscriptionPlanId(planId)) throw new ApiError('INVALID_REQUEST', 'The requested subscription plan is invalid.', 400);
  const licenseRef = adminDb.collection('organizations').doc(orgId).collection('license').doc('current');
  const organizationRef = adminDb.collection('organizations').doc(orgId);
  const memberRef = organizationRef.collection('members').doc(actor.uid);
  const planDocumentRef = planRef(planId);
  const counterRef = usageRef(planId);
  const auditRef = adminDb.collection('platformAuditLogs').doc();

  return adminDb.runTransaction(async (transaction) => {
    const organizationSnapshot = await transaction.get(organizationRef);
    const memberSnapshot = await transaction.get(memberRef);
    const planSnapshot = await transaction.get(planDocumentRef);
    const counterSnapshot = await transaction.get(counterRef);
    const licenseSnapshot = await transaction.get(licenseRef);
    if (!organizationSnapshot.exists) throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
    const member = memberSnapshot.data() || {};
    if (!memberSnapshot.exists || member.status?.toString().toLowerCase() !== 'active' || member.role !== 'ADMIN') {
      throw new ApiError('UNAUTHORIZED', 'The authenticated user is not authorized to start a subscription for this organization.', 403);
    }
    const plan = planFromSnapshot(planId, planSnapshot.exists, planSnapshot.data());
    if (!plan) throw new ApiError('INVALID_REQUEST', 'The requested subscription plan is invalid.', 400);

    const now = Timestamp.now();
    const current = licenseSnapshot.exists ? licenseSnapshot.data() || {} : undefined;
    const existing = idempotentTrialResult(orgId, plan, current, now.toMillis());
    if (existing) return existing;
    const existingLegacy = existingLegacyLicenseResult(orgId, current, now.toMillis());
    if (existingLegacy) return existingLegacy;
    if (!plan.publicSignup) throw new ApiError('CONFLICT', 'This subscription plan is not currently available for public signup.', 409);
    const currentState = currentLicenseCanStartTrial(current, now.toMillis());
    if (!currentState.allowed) throw new ApiError('CONFLICT', currentState.reason || 'The organization cannot start a new trial.', 409);

    const counterData = counterSnapshot.exists ? counterSnapshot.data() || {} : undefined;
    const eligibleCustomerCount = await allocationCountInTransaction(transaction, plan, counterData, now.toMillis());
    const usage = buildSubscriptionPlanUsage(plan, eligibleCustomerCount);
    if (usage.isFull) throw new ApiError('CONFLICT', 'The Founding 100 customer limit has been reached.', 409);

    const entitlement = entitlementForPlan(plan);
    const trialEndsAt = Timestamp.fromMillis(now.toMillis() + plan.trialDays * DAY_MS);
    const nextLicense = {
      organizationId: orgId,
      planId: plan.planId,
      entitlementTier: entitlement.entitlementTier,
      // `status` and the organization mirror remain the legacy Client App
      // enforcement contract. `subscriptionStatus` is the platform contract.
      plan: 'TRIAL',
      status: 'TRIAL',
      subscriptionStatus: 'trialing' as const,
      maxUsers: entitlement.maxUsers,
      features: DEFAULT_LICENSE_FEATURES,
      trialStartedAt: now,
      trialEndsAt,
      subscriptionStartedAt: null,
      subscriptionEndsAt: null,
      renewalDate: null,
      priceAtSubscription: plan.price,
      currency: plan.currency,
      billingInterval: plan.billingInterval,
      createdAt: timestampValue(current?.createdAt) || now,
      updatedAt: now,
      updatedBy: actor.uid,
    };
    const canonical = parseCanonicalLicense(nextLicense);
    if (!canonical) throw new ApiError('INTERNAL_ERROR', 'The subscription trial could not produce a valid Client App license.', 500);
    const mirrors = buildOrganizationLicenseMirror(canonical, now.toMillis());
    transaction.set(licenseRef, { ...nextLicense, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(organizationRef, { ...mirrors, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(counterRef, { ...buildSubscriptionPlanUsage(plan, eligibleCustomerCount + 1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(auditRef, {
      action: 'SUBSCRIPTION_TRIAL_STARTED',
      actorUid: actor.uid,
      actorRole: 'ORGANIZATION_ADMIN',
      targetType: 'ORGANIZATION_LICENSE',
      targetId: orgId,
      organizationId: orgId,
      metadata: {
        planId: plan.planId,
        entitlementTier: entitlement.entitlementTier,
        maxUsers: entitlement.maxUsers,
        storageLimitBytes: entitlement.storageLimitBytes,
        priceAtSubscription: plan.price,
        currency: plan.currency,
        billingInterval: plan.billingInterval,
        licenseCreated: true,
        licenseLinked: true,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
    return { organizationId: orgId, plan: publicSubscriptionPlan(plan), license: licenseView(nextLicense, now.toMillis()), auditLogId: auditRef.id, idempotent: false };
  });
}

/**
 * Provisions a new workspace for the Client App onboarding boundary and links
 * its platform license in the same Admin SDK transaction. The caller supplies
 * only plan selection and workspace profile data; all commercial values come
 * from the server-side plan document/default catalog.
 */
export async function provisionSubscriptionTrial(
  planId: string,
  user: AuthenticatedClientUser,
  workspaceInput: unknown,
  idempotency?: SubscriptionProvisioningIdempotency,
): Promise<SubscriptionProvisioningResult> {
  if (!isSubscriptionPlanId(planId)) throw new ApiError('INVALID_PLAN', 'The requested subscription plan is invalid.', 400);
  const workspace = validateWorkspaceInput(workspaceInput);
  const organizationRef = adminDb.collection('organizations').doc();
  const slugRef = adminDb.collection('organizationSlugs').doc(workspace.slug);
  const memberRef = organizationRef.collection('members').doc(user.uid);
  const licenseRef = organizationRef.collection('license').doc('current');
  const settingsRef = organizationRef.collection('settings').doc('settings');
  const profileRef = adminDb.collection('users').doc(user.uid);
  const bootstrapRef = adminDb.collection('workspaceBootstrap').doc(user.uid);
  const planDocumentRef = planRef(planId);
  const counterRef = usageRef(planId);
  const auditRef = adminDb.collection('platformAuditLogs').doc();

  return adminDb.runTransaction(async (transaction) => {
    const [bootstrapSnapshot, slugSnapshot, profileSnapshot, planSnapshot, counterSnapshot, membershipSnapshot, idempotencySnapshot] = await Promise.all([
      transaction.get(bootstrapRef),
      transaction.get(slugRef),
      transaction.get(profileRef),
      transaction.get(planDocumentRef),
      transaction.get(counterRef),
      // The onboarding bootstrap record was introduced after V1. This
      // authenticated-user-only lookup catches a pre-bootstrap V1 workspace
      // before any new organization, license, or trial is written.
      transaction.get(adminDb.collectionGroup('members').where('userId', '==', user.uid)),
      idempotency ? transaction.get(idempotency.reference) : Promise.resolve(undefined),
    ]);
    const newOnboarding = !bootstrapSnapshot.exists && membershipSnapshot.empty && !idempotencySnapshot?.exists;
    assertActiveClientProfile(user.uid, profileSnapshot.data(), profileSnapshot.exists, newOnboarding, newOnboarding);
    const replay = idempotencySnapshot ? idempotencyReplayResult(idempotencySnapshot, idempotency) : null;
    if (replay) {
      const replayOrganization = adminDb.collection('organizations').doc(replay.organizationId);
      const [organizationSnapshot, memberSnapshot] = await Promise.all([
        transaction.get(replayOrganization),
        transaction.get(replayOrganization.collection('members').doc(user.uid)),
      ]);
      const member = memberSnapshot.data();
      if (!organizationSnapshot.exists || !memberSnapshot.exists || member?.status !== 'active' || member?.role !== 'ADMIN') {
        throw new ApiError('FORBIDDEN', 'This account is no longer authorized to provision this workspace.', 403);
      }
      return replay;
    }
    const plan = planFromSnapshot(planId, planSnapshot.exists, planSnapshot.data());
    if (!plan) throw new ApiError('INVALID_PLAN', 'The requested subscription plan is invalid.', 400);
    if (bootstrapSnapshot.exists) {
      let existingOrganizationId: string;
      try { existingOrganizationId = validateOrganizationId(bootstrapSnapshot.data()?.organizationId); }
      catch { throw new ApiError('WORKSPACE_ALREADY_EXISTS', 'This account already has a workspace that requires support review.', 409); }
      const result = await existingProvisioningResult(transaction, existingOrganizationId, user, plan, Timestamp.now().toMillis()) as SubscriptionProvisioningResult;
      completeIdempotencyRecord(transaction, idempotency, result);
      return result;
    }
    const memberOrganizationIds = [...new Set(membershipSnapshot.docs.flatMap((member) => {
      const organizationId = member.ref.parent.parent?.id;
      try { return organizationId ? [validateOrganizationId(organizationId)] : []; }
      catch { return []; }
    }))];
    if (memberOrganizationIds.length > 1) {
      throw new ApiError('WORKSPACE_ALREADY_EXISTS', 'This account already belongs to multiple workspaces and requires support review before provisioning.', 409);
    }
    if (memberOrganizationIds.length === 1) {
      const result = await existingProvisioningResult(transaction, memberOrganizationIds[0], user, plan, Timestamp.now().toMillis()) as SubscriptionProvisioningResult;
      completeIdempotencyRecord(transaction, idempotency, result);
      return result;
    }
    if (slugSnapshot.exists) throw new ApiError('WORKSPACE_ALREADY_EXISTS', 'That workspace name is already in use.', 409);
    if (!plan.publicSignup) throw new ApiError('PLAN_UNAVAILABLE', 'This subscription plan is not currently available for public signup.', 409);
    const counterData = counterSnapshot.exists ? counterSnapshot.data() || {} : undefined;
    const eligibleCustomerCount = await allocationCountInTransaction(transaction, plan, counterData);
    if (buildSubscriptionPlanUsage(plan, eligibleCustomerCount).isFull) throw new ApiError('FOUNDING_LIMIT_REACHED', 'The Founding 100 customer limit has been reached.', 409);

    const now = Timestamp.now();
    const trialEndsAt = Timestamp.fromMillis(now.toMillis() + plan.trialDays * DAY_MS);
    const profile = profileSnapshot.data() || {};
    const entitlement = entitlementForPlan(plan);
    const nextLicense = {
      organizationId: organizationRef.id,
      planId: plan.planId,
      entitlementTier: entitlement.entitlementTier,
      plan: 'TRIAL',
      status: 'TRIAL',
      subscriptionStatus: 'trialing' as const,
      maxUsers: entitlement.maxUsers,
      features: DEFAULT_LICENSE_FEATURES,
      trialStartedAt: now,
      trialEndsAt,
      subscriptionStartedAt: null,
      subscriptionEndsAt: null,
      renewalDate: null,
      priceAtSubscription: plan.price,
      currency: plan.currency,
      billingInterval: plan.billingInterval,
      createdAt: now,
      updatedAt: now,
      updatedBy: user.uid,
    };
    const canonical = parseCanonicalLicense(nextLicense);
    if (!canonical) throw new ApiError('PROVISIONING_FAILED', 'The subscription trial could not produce a valid Client App license.', 500);
    const mirrors = buildOrganizationLicenseMirror(canonical, now.toMillis());
    transaction.set(organizationRef, {
      name: workspace.name,
      slug: workspace.slug,
      businessType: workspace.businessType,
      // These historical root values are informational only. Client App
      // enforcement reads the canonical license and the four mirrors below.
      status: 'trial',
      plan: 'TRIAL',
      subscriptionStatus: 'trialing',
      ...mirrors,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdByUid: user.uid,
    });
    transaction.set(slugRef, { organizationId: organizationRef.id, slug: workspace.slug, createdAt: FieldValue.serverTimestamp(), createdByUid: user.uid });
    transaction.set(memberRef, {
      userId: user.uid,
      email: user.email,
      displayName: user.displayName,
      role: 'ADMIN',
      status: 'active',
      joinedAt: FieldValue.serverTimestamp(),
      activatedAt: FieldValue.serverTimestamp(),
      activatedBy: user.uid,
    });
    transaction.set(profileRef, {
      uid: user.uid,
      name: user.displayName || profile.name || 'User',
      email: user.email || profile.email || '',
      displayName: user.displayName || profile.displayName || 'User',
      photoURL: typeof profile.photoURL === 'string' ? profile.photoURL : '',
      role: typeof profile.role === 'string' ? profile.role : 'USER',
      status: 'active',
      active: true,
      createdAt: profile.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(settingsRef, {
      businessName: workspace.name,
      businessType: workspace.businessType,
      email: user.email,
      phone: workspace.phone,
      website: workspace.website,
      address: '',
      currency: workspace.currency,
      timezone: workspace.timezone,
      logoUrl: '',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(licenseRef, { ...nextLicense, updatedAt: FieldValue.serverTimestamp() });
    transaction.set(bootstrapRef, { organizationId: organizationRef.id, planId: plan.planId, createdAt: FieldValue.serverTimestamp(), createdByUid: user.uid });
    transaction.set(counterRef, { ...buildSubscriptionPlanUsage(plan, eligibleCustomerCount + 1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(auditRef, {
      action: 'SUBSCRIPTION_TRIAL_STARTED',
      actorUid: user.uid,
      actorRole: 'ORGANIZATION_ADMIN',
      targetType: 'ORGANIZATION_LICENSE',
      targetId: organizationRef.id,
      organizationId: organizationRef.id,
      metadata: {
        planId: plan.planId,
        entitlementTier: entitlement.entitlementTier,
        maxUsers: entitlement.maxUsers,
        storageLimitBytes: entitlement.storageLimitBytes,
        provisioning: true,
        priceAtSubscription: plan.price,
        currency: plan.currency,
        billingInterval: plan.billingInterval,
        licenseCreated: true,
        licenseLinked: true,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
    const result: SubscriptionProvisioningResult = {
      workspaceId: organizationRef.id,
      organizationId: organizationRef.id,
      plan: publicSubscriptionPlan(plan),
      license: { ...(licenseView(nextLicense, now.toMillis()) || {}), planCode: plan.code, planName: plan.displayName, trialDaysRemaining: plan.trialDays },
      auditLogId: auditRef.id,
      idempotent: false,
    };
    completeIdempotencyRecord(transaction, idempotency, result);
    return result;
  });
}

/** Explicit alias for integrations that describe trial creation as license linking. */
export const linkSubscriptionLicense = startSubscriptionTrial;

export function subscriptionStatusFromLicenseData(data: Record<string, unknown>, now = Date.now()) {
  return effectiveSubscriptionStatus(data, now);
}
