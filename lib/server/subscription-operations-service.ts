import { adminDb } from './firebase-admin-core';
import { ApiError } from './api-errors';
import { getConsoleOrganizationSummary, listConsoleOrganizations, listConsoleSubscriptionOrganizationPage } from './console-read-service';
import { listCanonicalLicenseDocuments } from './canonical-license-query';
import { validateOrganizationId } from './request';
import { compareFounding100Usage, listSubscriptionPlans } from './subscription-plan-service';
import { compareOrganizationLicenseMirror, parseCanonicalLicense, resolveCanonicalLicense } from '../license-contract';
import type {
  ConsoleSubscriptionPlan,
  Organization,
  SubscriptionAuditHistoryItem,
  SubscriptionLicenseDetail,
  SubscriptionOperationLicense,
  SubscriptionOperationLicenseFilters,
  SubscriptionOperationLicensePage,
  SubscriptionOperationsData,
} from '../types';

const DAY_MS = 86_400_000;
const LICENSE_PAGE_SIZE = 25;
const LICENSE_PAGE_SCAN_CAP = 100;
const LICENSE_STATUS_FILTERS = ['ALL', 'ACTIVE', 'TRIAL', 'EXPIRED', 'SUSPENDED', 'NO_LICENSE', 'NEEDS_ATTENTION'] as const;
const LICENSE_RENEWAL_FILTERS = ['ALL', 'WITHIN_7', 'WITHIN_30', 'WITHIN_90', 'OVERDUE', 'NO_DATE'] as const;
const LICENSE_TRIAL_FILTERS = ['ALL', 'WITHIN_7', 'WITHIN_14', 'EXPIRED', 'NO_TRIAL'] as const;
const SUBSCRIPTION_AUDIT_ACTIONS = new Set([
  'SUBSCRIPTION_TRIAL_STARTED',
  'ORGANIZATION_LICENSE_ACTIVATED',
  'ORGANIZATION_LICENSE_REPAIRED',
  'ORGANIZATION_LICENSE_ADMIN_CORRECTED',
  'ORGANIZATION_LICENSE_RENEWED',
  'TRIAL_EXTENDED',
  'ORGANIZATION_TRIAL_CONVERTED_TO_PAID',
  'ORGANIZATION_SUBSCRIPTION_EXTENDED',
  'ORGANIZATION_PLAN_CHANGED',
  'MAX_USERS_CHANGED',
  'ORGANIZATION_LICENSE_SUSPENDED',
  'ORGANIZATION_LICENSE_EXPIRED',
  'ORGANIZATION_LICENSE_REACTIVATED',
]);
const COMMERCIAL_PRODUCT_MANAGED_ACTIONS = new Set(['CHANGE_PLAN', 'CHANGE_SEAT_LIMIT']);

type PlanLookup = Pick<ConsoleSubscriptionPlan, 'planId' | 'code' | 'entitlementTier' | 'displayName' | 'price' | 'currency' | 'billingInterval' | 'trialDays' | 'noCreditCardRequired' | 'foundingLimit' | 'maxEligibleCustomers' | 'publicSignup'>;
type SubscriptionOrganization = Pick<Organization, 'id' | 'name' | 'license' | 'licenseDocumentState' | 'licenseAdminState' | 'activeMemberCount'>;

function timestampMillis(value: unknown): number | undefined {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().getTime();
  return undefined;
}

function isoDate(value: unknown): string | undefined {
  const millis = timestampMillis(value);
  return millis === undefined ? undefined : new Date(millis).toISOString();
}

function planLookup(plans: ConsoleSubscriptionPlan[]) {
  return new Map(plans.map((plan) => [plan.planId, {
    planId: plan.planId,
    code: plan.code,
    entitlementTier: plan.entitlementTier,
    displayName: plan.displayName,
    price: plan.price,
    currency: plan.currency,
    billingInterval: plan.billingInterval,
    trialDays: plan.trialDays,
    noCreditCardRequired: plan.noCreditCardRequired,
    foundingLimit: plan.foundingLimit,
    maxEligibleCustomers: plan.maxEligibleCustomers,
    publicSignup: plan.publicSignup,
  } satisfies PlanLookup]));
}

function toSubscriptionOperationLicense(organization: SubscriptionOrganization, plans: Map<string, PlanLookup>): SubscriptionOperationLicense {
  const license = organization.license;
  const planId = license?.planId || null;
  const configuredPlan = planId ? plans.get(planId) : undefined;
  const state = organization.licenseAdminState;
  return {
    organizationId: organization.id,
    organizationName: organization.name,
    planId,
    planName: configuredPlan?.displayName || license?.plan || null,
    entitlementTier: license?.entitlementTier || configuredPlan?.entitlementTier || null,
    canonicalPlan: license?.plan || null,
    status: state?.status || 'UNKNOWN',
    canonicalStatus: license?.canonicalStatus || null,
    documentState: organization.licenseDocumentState || 'NO_LICENSE',
    trialEndsAt: license?.trialEndsAt,
    subscriptionStartedAt: license?.subscriptionStartedAt,
    subscriptionEndsAt: license?.subscriptionEndsAt,
    renewalDate: license?.renewalDate,
    priceAtSubscription: license?.priceAtSubscription ?? null,
    currency: license?.currency,
    billingInterval: license?.billingInterval,
    activeSeatCount: organization.activeMemberCount || 0,
    maxUsers: state?.maxUsers ?? license?.maxUsers ?? null,
    allowedActions: (state?.allowedActions || []).filter((action) => !(license?.planId && COMMERCIAL_PRODUCT_MANAGED_ACTIONS.has(action))),
  };
}

function upcomingRenewals(licenses: SubscriptionOperationLicense[], now: number) {
  const end = now + (30 * DAY_MS);
  return licenses
    .map((license) => ({ license, dueAt: timestampMillis(license.renewalDate || license.subscriptionEndsAt) }))
    .filter((item) => item.license.status === 'ACTIVE' && item.dueAt !== undefined && item.dueAt >= now && item.dueAt <= end)
    .sort((left, right) => (left.dueAt || 0) - (right.dueAt || 0))
    .slice(0, 10)
    .map((item) => item.license);
}

function foundingUsageOverview(
  plan: PlanLookup | undefined,
  comparison: Awaited<ReturnType<typeof compareFounding100Usage>>,
) {
  // A valid Founding catalog always provides a positive configured limit. The
  // defensive zero only lets a read-only health/operations response surface a
  // broken catalog without inventing an enrollment capacity.
  const limit = plan?.foundingLimit ?? comparison.limit ?? 0;
  const canonicalEligibleCustomerCount = comparison.canonicalEligibleCustomerCount;
  return {
    limit,
    remainingCapacity: Math.max(0, limit - canonicalEligibleCustomerCount),
    usageExceedsLimit: canonicalEligibleCustomerCount > limit,
    publicSignup: plan?.publicSignup === true,
    canonicalEligibleCustomerCount,
    storedEligibleCustomerCount: comparison.storedEligibleCustomerCount,
    difference: comparison.difference,
    matches: comparison.matches,
  };
}

/** Minimal license projection used for read-only overview counts and renewals. */
function canonicalOverviewLicense(data: Record<string, unknown>, organizationId: string, plans: Map<string, PlanLookup>, now: number): SubscriptionOperationLicense | null {
  const canonical = parseCanonicalLicense(data);
  if (!canonical) return null;
  const effective = resolveCanonicalLicense(canonical, now);
  const planId = typeof data.planId === 'string' ? data.planId : null;
  const configuredPlan = planId ? plans.get(planId) : undefined;
  return {
    organizationId,
    organizationName: 'Organization',
    planId,
    planName: configuredPlan?.displayName || canonical.plan,
    entitlementTier: canonical.entitlementTier || configuredPlan?.entitlementTier || null,
    canonicalPlan: canonical.plan,
    status: effective.status,
    canonicalStatus: canonical.status,
    documentState: 'VALID_LICENSE',
    trialEndsAt: isoDate(canonical.trialEndsAt),
    subscriptionStartedAt: isoDate(canonical.subscriptionStartedAt),
    subscriptionEndsAt: isoDate(canonical.subscriptionEndsAt),
    renewalDate: isoDate(data.renewalDate),
    priceAtSubscription: typeof data.priceAtSubscription === 'number' ? data.priceAtSubscription : null,
    currency: typeof data.currency === 'string' ? data.currency : undefined,
    billingInterval: typeof data.billingInterval === 'string' ? data.billingInterval : undefined,
    activeSeatCount: 0,
    maxUsers: canonical.maxUsers,
    allowedActions: [],
  };
}

async function withUpcomingOrganizationNames(licenses: SubscriptionOperationLicense[]) {
  const snapshots = await Promise.all(licenses.map((license) => adminDb.collection('organizations').doc(license.organizationId).get()));
  return licenses.map((license, index) => ({
    ...license,
    organizationName: snapshots[index].exists && typeof snapshots[index].data()?.name === 'string'
      ? snapshots[index].data()?.name as string
      : 'Unnamed organization',
  }));
}

function displayStatus(license: SubscriptionOperationLicense) {
  if (license.documentState === 'NO_LICENSE') return 'NO_LICENSE';
  if (license.documentState === 'INVALID_LICENSE') return 'NEEDS_ATTENTION';
  return license.status;
}

function renewalAt(license: SubscriptionOperationLicense) {
  return license.renewalDate || license.subscriptionEndsAt;
}

function inUpcomingPeriod(value: string | undefined, period: SubscriptionOperationLicenseFilters['renewalPeriod'], now: number) {
  if (!period || period === 'ALL') return true;
  const dueAt = timestampMillis(value);
  if (period === 'NO_DATE') return dueAt === undefined;
  if (dueAt === undefined) return false;
  if (period === 'OVERDUE') return dueAt < now;
  const days = period === 'WITHIN_7' ? 7 : period === 'WITHIN_30' ? 30 : 90;
  return dueAt >= now && dueAt <= now + days * DAY_MS;
}

function trialMatches(value: string | undefined, period: SubscriptionOperationLicenseFilters['trialExpiration'], now: number) {
  if (!period || period === 'ALL') return true;
  const endsAt = timestampMillis(value);
  if (period === 'NO_TRIAL') return endsAt === undefined;
  if (endsAt === undefined) return false;
  if (period === 'EXPIRED') return endsAt < now;
  const days = period === 'WITHIN_7' ? 7 : 14;
  return endsAt >= now && endsAt <= now + days * DAY_MS;
}

function enumFilter<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (value === undefined || value === null || value === '') return allowed[0];
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new ApiError('INVALID_REQUEST', `Invalid ${field} filter.`, 400);
  return value as T;
}

/** Validates all browser-provided pagination filters before any Firestore read. */
export function parseSubscriptionOperationLicenseFilters(value: SubscriptionOperationLicenseFilters = {}) {
  if (value.query !== undefined && typeof value.query !== 'string') throw new ApiError('INVALID_REQUEST', 'Invalid search query.', 400);
  if (value.plan !== undefined && typeof value.plan !== 'string') throw new ApiError('INVALID_REQUEST', 'Invalid plan filter.', 400);
  const query = value.query?.trim();
  if (query !== undefined && query.length > 120) throw new ApiError('INVALID_REQUEST', 'Search query is too long.', 400);
  const plan = value.plan?.trim();
  if (plan !== undefined && plan !== 'ALL' && !/^[A-Za-z0-9_]{1,80}$/.test(plan)) throw new ApiError('INVALID_REQUEST', 'Invalid plan filter.', 400);
  return {
    ...(query ? { query: query.toLowerCase() } : {}),
    ...(plan && plan !== 'ALL' ? { plan } : {}),
    status: enumFilter(value.status, LICENSE_STATUS_FILTERS, 'status'),
    renewalPeriod: enumFilter(value.renewalPeriod, LICENSE_RENEWAL_FILTERS, 'renewal period'),
    trialExpiration: enumFilter(value.trialExpiration, LICENSE_TRIAL_FILTERS, 'trial expiration'),
  };
}

function licenseMatchesFilters(license: SubscriptionOperationLicense, filters: ReturnType<typeof parseSubscriptionOperationLicenseFilters>, now: number) {
  const matchesQuery = !filters.query || [license.organizationName, license.organizationId]
    .some((value) => value.toLowerCase().includes(filters.query!));
  const matchesPlan = !filters.plan || license.planId === filters.plan || license.canonicalPlan === filters.plan;
  const matchesStatus = filters.status === 'ALL' || displayStatus(license) === filters.status;
  return matchesQuery && matchesPlan && matchesStatus
    && inUpcomingPeriod(renewalAt(license), filters.renewalPeriod, now)
    && trialMatches(license.trialEndsAt, filters.trialExpiration, now);
}

/**
 * Server-side paginated license projection. Each request reads only bounded
 * organization pages and hydrates only the canonical license plus active-seat
 * aggregate needed for this table. Filter scans are capped so a broad search
 * cannot turn into an unbounded Firestore read.
 */
export async function listSubscriptionOperationLicenses(
  requestedFilters: SubscriptionOperationLicenseFilters = {},
  cursor?: string,
): Promise<SubscriptionOperationLicensePage> {
  const filters = parseSubscriptionOperationLicenseFilters(requestedFilters);
  const rawPlans = await listSubscriptionPlans();
  const plans = planLookup(rawPlans as unknown as ConsoleSubscriptionPlan[]);
  const now = Date.now();
  const licenses: SubscriptionOperationLicense[] = [];
  let currentCursor = cursor;
  let lastScannedCursor: string | undefined;
  let scanned = 0;

  while (licenses.length < LICENSE_PAGE_SIZE && scanned < LICENSE_PAGE_SCAN_CAP) {
    const batchSize = Math.min(LICENSE_PAGE_SIZE, LICENSE_PAGE_SCAN_CAP - scanned);
    const batch = await listConsoleSubscriptionOrganizationPage(batchSize, currentCursor);
    if (!batch.organizations.length) return { licenses, hasMore: false };
    const candidates = batch.organizations.map((organization) => toSubscriptionOperationLicense(organization as SubscriptionOrganization, plans));
    for (const license of candidates) {
      scanned += 1;
      lastScannedCursor = license.organizationId;
      if (licenseMatchesFilters(license, filters, now)) licenses.push(license);
      if (licenses.length === LICENSE_PAGE_SIZE) {
        const candidateIndex = candidates.indexOf(license);
        const hasMore = candidateIndex < candidates.length - 1 || batch.hasMore;
        return { licenses, ...(hasMore && lastScannedCursor ? { nextCursor: lastScannedCursor } : {}), hasMore };
      }
    }
    if (!batch.hasMore) return { licenses, hasMore: false };
    currentCursor = lastScannedCursor;
  }

  return { licenses, ...(lastScannedCursor ? { nextCursor: lastScannedCursor } : {}), hasMore: Boolean(lastScannedCursor) };
}

function safeSubscriptionAuditItem(id: string, data: Record<string, unknown>): SubscriptionAuditHistoryItem | null {
  const action = typeof data.action === 'string' ? data.action : '';
  if (!SUBSCRIPTION_AUDIT_ACTIONS.has(action)) return null;
  const metadata = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
    ? data.metadata as Record<string, unknown>
    : {};
  return {
    id,
    action,
    actorRole: typeof data.actorRole === 'string' ? data.actorRole : undefined,
    createdAt: isoDate(data.createdAt),
    planId: typeof metadata.planId === 'string' ? metadata.planId : undefined,
    priceAtSubscription: typeof metadata.priceAtSubscription === 'number' ? metadata.priceAtSubscription : undefined,
    currency: typeof metadata.currency === 'string' ? metadata.currency : undefined,
    billingInterval: typeof metadata.billingInterval === 'string' ? metadata.billingInterval : undefined,
    provisioning: metadata.provisioning === true ? true : undefined,
  };
}

async function listSubscriptionAuditHistory(organizationId: string, limit = 50) {
  const snapshot = await adminDb.collection('platformAuditLogs')
    .where('organizationId', '==', organizationId)
    .orderBy('createdAt', 'desc')
    .limit(Math.min(Math.max(limit, 1), 100))
    .get();
  return snapshot.docs
    .map((item) => safeSubscriptionAuditItem(item.id, item.data()))
    .filter((item): item is SubscriptionAuditHistoryItem => item !== null)
    .sort((left, right) => (timestampMillis(right.createdAt) || 0) - (timestampMillis(left.createdAt) || 0));
}

/**
 * Platform-admin read model for subscription operations. It intentionally
 * projects only license, plan, seat, and organization-name fields; no CRM
 * collections or customer records are queried or returned.
 */
export async function getSubscriptionOperations(): Promise<SubscriptionOperationsData> {
  const [organizations, rawPlans, foundingComparison] = await Promise.all([
    listConsoleOrganizations(),
    listSubscriptionPlans(),
    compareFounding100Usage(),
  ]);
  const plans = rawPlans as unknown as ConsoleSubscriptionPlan[];
  const plansById = planLookup(plans);
  const licenses = organizations.map((organization) => toSubscriptionOperationLicense(organization as Organization, plansById));
  const foundingPlan = plansById.get('founding_100');
  const now = Date.now();
  return {
    overview: {
      founding100: {
        ...foundingUsageOverview(foundingPlan, foundingComparison),
      },
      standardSubscriptionCount: licenses.filter((license) => license.planId === 'standard' && license.documentState === 'VALID_LICENSE').length,
      trialCount: licenses.filter((license) => license.status === 'TRIAL').length,
      activeCount: licenses.filter((license) => license.status === 'ACTIVE').length,
      expiredCount: licenses.filter((license) => license.status === 'EXPIRED').length,
      suspendedCount: licenses.filter((license) => license.status === 'SUSPENDED').length,
      upcomingRenewals: upcomingRenewals(licenses, now),
    },
    licenses,
  };
}

/**
 * Compact, read-only integrity projection used by Platform Health. It reads
 * only organization roots, canonical license documents, plan configuration,
 * and the Founding usage counter. In particular, it does not hydrate tenant
 * settings, member lists, CRM records, or the full subscription-operations
 * table just to calculate health warnings.
 */
export async function getPlatformSubscriptionHealthInspection() {
  const now = Date.now();
  const [canonicalDocuments, organizationSnapshot] = await Promise.all([
    listCanonicalLicenseDocuments(),
    adminDb.collection('organizations').get(),
  ]);
  const [rawPlans, foundingComparison] = await Promise.all([
    // Reuse the canonical scan above for the capped Founding allocation view.
    listSubscriptionPlans(canonicalDocuments),
    compareFounding100Usage(canonicalDocuments),
  ]);
  const plans = rawPlans as unknown as ConsoleSubscriptionPlan[];
  const plansById = planLookup(plans);
  const canonicalByOrganization = new Map<string, Record<string, unknown>>();

  for (const document of canonicalDocuments) {
    const segments = document.ref.path.split('/');
    // Only organizations/{organizationId}/license/current is a canonical
    // organization license. A different nested collection named "license"
    // must not influence the operational health of an organization.
    if (segments.length === 4 && segments[0] === 'organizations' && segments[2] === 'license' && segments[3] === 'current') {
      canonicalByOrganization.set(segments[1], document.data());
    }
  }

  const licenses: SubscriptionOperationLicense[] = [];
  let malformedCanonicalLicenseCount = 0;
  let missingCanonicalLicenseCount = 0;
  let driftedMirrorCount = 0;

  for (const organization of organizationSnapshot.docs) {
    const rawLicense = canonicalByOrganization.get(organization.id);
    if (!rawLicense) {
      missingCanonicalLicenseCount += 1;
      continue;
    }

    const canonical = parseCanonicalLicense(rawLicense);
    const license = canonicalOverviewLicense(rawLicense, organization.id, plansById, now);
    if (!canonical || !license) {
      malformedCanonicalLicenseCount += 1;
      continue;
    }

    licenses.push(license);
    if (compareOrganizationLicenseMirror(canonical, organization.data() || {}, now).status === 'DRIFTED') {
      driftedMirrorCount += 1;
    }
  }

  const foundingPlan = plansById.get('founding_100');
  return {
    overview: {
      founding100: foundingUsageOverview(foundingPlan, foundingComparison),
      standardSubscriptionCount: licenses.filter((license) => license.planId === 'standard').length,
      trialCount: licenses.filter((license) => license.status === 'TRIAL').length,
      activeCount: licenses.filter((license) => license.status === 'ACTIVE').length,
      expiredCount: licenses.filter((license) => license.status === 'EXPIRED').length,
      suspendedCount: licenses.filter((license) => license.status === 'SUSPENDED').length,
    },
    integrity: {
      totalOrganizations: organizationSnapshot.size,
      validCanonicalLicenseCount: licenses.length,
      malformedCanonicalLicenseCount,
      missingCanonicalLicenseCount,
      mirrors: {
        inspectedOrganizationCount: organizationSnapshot.size,
        comparableCanonicalLicenseCount: licenses.length,
        unavailableCanonicalLicenseCount: malformedCanonicalLicenseCount + missingCanonicalLicenseCount,
        driftedCount: driftedMirrorCount,
      },
    },
  };
}

/** Overview retains the existing canonical calculations without sending every license record to the browser. */
export async function getSubscriptionOperationsOverview() {
  const [rawPlans, canonicalDocuments] = await Promise.all([
    listSubscriptionPlans(),
    listCanonicalLicenseDocuments(),
  ]);
  const plans = rawPlans as unknown as ConsoleSubscriptionPlan[];
  const plansById = planLookup(plans);
  const now = Date.now();
  const licenses = canonicalDocuments.flatMap((document) => {
    const organizationId = document.ref.parent.parent?.id;
    if (!organizationId) return [];
    const license = canonicalOverviewLicense(document.data(), organizationId, plansById, now);
    return license ? [license] : [];
  });
  const [foundingComparison, upcoming] = await Promise.all([
    compareFounding100Usage(canonicalDocuments),
    withUpcomingOrganizationNames(upcomingRenewals(licenses, now)),
  ]);
  const foundingPlan = plansById.get('founding_100');
  return {
    founding100: {
      ...foundingUsageOverview(foundingPlan, foundingComparison),
    },
    standardSubscriptionCount: licenses.filter((license) => license.planId === 'standard').length,
    trialCount: licenses.filter((license) => license.status === 'TRIAL').length,
    activeCount: licenses.filter((license) => license.status === 'ACTIVE').length,
    expiredCount: licenses.filter((license) => license.status === 'EXPIRED').length,
    suspendedCount: licenses.filter((license) => license.status === 'SUSPENDED').length,
    upcomingRenewals: upcoming,
  };
}

export async function getSubscriptionLicenseDetail(organizationId: string): Promise<SubscriptionLicenseDetail> {
  const orgId = validateOrganizationId(organizationId);
  const [organizationResult, rawPlans, auditHistory] = await Promise.all([
    getConsoleOrganizationSummary(orgId),
    listSubscriptionPlans(),
    listSubscriptionAuditHistory(orgId),
  ]);
  if (!organizationResult) throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
  const plans = rawPlans as unknown as ConsoleSubscriptionPlan[];
  const plansById = planLookup(plans);
  const license = toSubscriptionOperationLicense(organizationResult as Organization, plansById);
  return {
    license,
    plan: license.planId ? plansById.get(license.planId) || null : null,
    auditHistory,
  };
}
