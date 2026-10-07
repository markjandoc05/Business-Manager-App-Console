import { FieldPath, type DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin-core';
import { ApiError } from './api-errors';
import { getConsoleOrganizationSummary, getConsoleOrganizationView } from './console-read-service';
import { validateOrganizationId } from './request';
import { listSubscriptionPlans } from './subscription-plan-service';
import type {
  ConsoleSubscriptionPlan,
  ConsoleMembership,
  Organization,
  OrganizationMemberStatus,
  OrganizationMembershipFilters,
  OrganizationMembershipPage,
  OrganizationOperationsDetail,
  OrganizationPlatformAuditItem,
  OrganizationRegistryEntry,
  OrganizationRegistryFilters,
  OrganizationRegistryPage,
} from '../types';

const DAY_MS = 86_400_000;
const REGISTRY_PAGE_SIZE = 25;
const REGISTRY_SCAN_CAP = 100;
const MEMBERSHIP_PAGE_SIZE = 25;
const MEMBERSHIP_SCAN_CAP = 100;
const REGISTRY_LICENSE_STATUSES = ['ALL', 'ACTIVE', 'TRIAL', 'EXPIRED', 'SUSPENDED', 'NO_LICENSE', 'NEEDS_ATTENTION'] as const;
const REGISTRY_PLATFORM_STATUSES = ['ALL', 'HEALTHY', 'WARNING', 'ACTION_REQUIRED'] as const;
const REGISTRY_CREATION_DATES = ['ALL', 'WITHIN_7', 'WITHIN_30', 'WITHIN_90', 'OLDER_THAN_90', 'UNKNOWN'] as const;
const REGISTRY_LIFECYCLES = ['ALL', 'TRIAL_ENDS_7', 'TRIAL_ENDED', 'RENEWS_30', 'RENEWAL_OVERDUE', 'NO_RENEWAL_OR_TRIAL_DATE'] as const;
const MEMBER_STATUSES = ['ALL', 'ACTIVE', 'PENDING', 'INACTIVE', 'SUSPENDED', 'ARCHIVED', 'DISABLED'] as const;

const ORGANIZATION_PLATFORM_AUDIT_ACTIONS = new Set([
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
  'ORGANIZATION_PROFILE_UPDATED',
  'ORGANIZATION_TIMEZONE_UPDATED',
  'ORGANIZATION_CURRENCY_UPDATED',
  'ORGANIZATION_MEMBER_ADDED',
  'ORGANIZATION_MEMBER_INVITED',
  'ORGANIZATION_MEMBER_ROLE_CHANGED',
  'ORGANIZATION_MEMBER_SUSPENDED',
  'ORGANIZATION_MEMBER_REACTIVATED',
  'ORGANIZATION_MEMBER_ARCHIVED',
  'ORGANIZATION_MEMBER_RESTORED',
  'ORGANIZATION_MEMBER_STATUS_CHANGED',
  'ORGANIZATION_REGISTRATION_RESET',
]);

type PlanLookup = Pick<ConsoleSubscriptionPlan, 'planId' | 'displayName'>;

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
    displayName: plan.displayName,
  } satisfies PlanLookup]));
}

function memberStatus(value: unknown): OrganizationMemberStatus {
  switch (typeof value === 'string' ? value.toUpperCase() : '') {
    case 'PENDING': return 'PENDING';
    case 'INACTIVE': return 'INACTIVE';
    case 'SUSPENDED': return 'SUSPENDED';
    case 'ARCHIVED': return 'ARCHIVED';
    case 'DISABLED': return 'DISABLED';
    default: return 'ACTIVE';
  }
}

function memberLoginStatus(value: unknown): 'SUCCESS' | 'FAILED' | undefined {
  return value === 'SUCCESS' || value === 'FAILED' ? value : undefined;
}

function enumFilter<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (value === undefined || value === null || value === '') return allowed[0];
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new ApiError('INVALID_REQUEST', `Invalid ${field} filter.`, 400);
  return value as T;
}

function optionalQuery(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ApiError('INVALID_REQUEST', `Invalid ${field}.`, 400);
  const normalized = value.trim();
  if (normalized.length > 120) throw new ApiError('INVALID_REQUEST', `${field} is too long.`, 400);
  return normalized || undefined;
}

function paginationCursor(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 512 || value.includes('/')) throw new ApiError('INVALID_REQUEST', `Invalid ${field}.`, 400);
  return value;
}

function visibleLicenseStatus(record: OrganizationRegistryEntry) {
  if (record.licenseDocumentState === 'NO_LICENSE') return 'NO_LICENSE' as const;
  if (record.licenseDocumentState === 'INVALID_LICENSE') return 'NEEDS_ATTENTION' as const;
  if (record.licenseStatus === 'ACTIVE' || record.licenseStatus === 'TRIAL' || record.licenseStatus === 'EXPIRED' || record.licenseStatus === 'SUSPENDED') return record.licenseStatus;
  return 'NEEDS_ATTENTION' as const;
}

function creationMatches(value: string | undefined, filter: typeof REGISTRY_CREATION_DATES[number], now: number) {
  if (filter === 'ALL') return true;
  const createdAt = timestampMillis(value);
  if (filter === 'UNKNOWN') return createdAt === undefined;
  if (createdAt === undefined) return false;
  if (filter === 'OLDER_THAN_90') return createdAt < now - 90 * DAY_MS;
  const days = filter === 'WITHIN_7' ? 7 : filter === 'WITHIN_30' ? 30 : 90;
  return createdAt >= now - days * DAY_MS && createdAt <= now;
}

function lifecycleMatches(record: OrganizationRegistryEntry, filter: typeof REGISTRY_LIFECYCLES[number], now: number) {
  if (filter === 'ALL') return true;
  const trialEndsAt = timestampMillis(record.trialEndsAt);
  const renewalAt = timestampMillis(record.renewalDate || record.subscriptionEndsAt);
  if (filter === 'NO_RENEWAL_OR_TRIAL_DATE') return trialEndsAt === undefined && renewalAt === undefined;
  if (filter === 'TRIAL_ENDED') return trialEndsAt !== undefined && trialEndsAt < now;
  if (filter === 'TRIAL_ENDS_7') return trialEndsAt !== undefined && trialEndsAt >= now && trialEndsAt <= now + 7 * DAY_MS;
  if (filter === 'RENEWAL_OVERDUE') return renewalAt !== undefined && renewalAt < now;
  return renewalAt !== undefined && renewalAt >= now && renewalAt <= now + 30 * DAY_MS;
}

/** Validate browser filters before a registry page performs any Firestore work. */
export function parseOrganizationRegistryFilters(value: OrganizationRegistryFilters = {}) {
  const query = optionalQuery(value.query, 'search query');
  const plan = optionalQuery(value.plan, 'plan filter');
  if (plan && !/^[A-Za-z0-9_]{1,80}$/.test(plan)) throw new ApiError('INVALID_REQUEST', 'Invalid plan filter.', 400);
  return {
    ...(query ? { query: query.toLowerCase() } : {}),
    ...(plan && plan !== 'ALL' ? { plan } : {}),
    licenseStatus: enumFilter(value.licenseStatus, REGISTRY_LICENSE_STATUSES, 'license status'),
    platformStatus: enumFilter(value.platformStatus, REGISTRY_PLATFORM_STATUSES, 'platform status'),
    creationDate: enumFilter(value.creationDate, REGISTRY_CREATION_DATES, 'creation date'),
    lifecycle: enumFilter(value.lifecycle, REGISTRY_LIFECYCLES, 'renewal or trial state'),
  };
}

function registryMatches(record: OrganizationRegistryEntry, filters: ReturnType<typeof parseOrganizationRegistryFilters>, now: number) {
  const queryValues = [record.organizationName, record.organizationId, record.platformMetadata.workspaceSlug].filter((value): value is string => Boolean(value));
  const matchesQuery = !filters.query || queryValues.some((value) => value.toLowerCase().includes(filters.query!));
  const matchesPlan = !filters.plan || record.planId === filters.plan || record.canonicalPlan === filters.plan;
  return matchesQuery
    && matchesPlan
    && (filters.licenseStatus === 'ALL' || visibleLicenseStatus(record) === filters.licenseStatus)
    && (filters.platformStatus === 'ALL' || record.platformStatus === filters.platformStatus)
    && creationMatches(record.createdAt, filters.creationDate, now)
    && lifecycleMatches(record, filters.lifecycle, now);
}

function hasRegistryFilters(filters: ReturnType<typeof parseOrganizationRegistryFilters>) {
  return Boolean(filters.query || filters.plan || filters.licenseStatus !== 'ALL' || filters.platformStatus !== 'ALL' || filters.creationDate !== 'ALL' || filters.lifecycle !== 'ALL');
}

/**
 * The registry projects only organization-root, canonical-license, and
 * seat-count metadata. It deliberately never reads tenant business-data or
 * member collections.
 */
function toRegistryEntry(organization: Organization, plans: Map<string, PlanLookup>): OrganizationRegistryEntry {
  const license = organization.license;
  const state = organization.licenseAdminState;
  const planId = license?.planId || null;
  const configuredPlan = planId ? plans.get(planId) : undefined;
  return {
    organizationId: organization.id,
    organizationName: organization.name,
    platformStatus: organization.organizationAdminState?.health || 'ACTION_REQUIRED',
    createdAt: organization.createdAt,
    planId,
    planName: configuredPlan?.displayName || license?.plan || state?.plan || null,
    canonicalPlan: license?.plan || state?.plan || null,
    licenseStatus: state?.status || 'UNKNOWN',
    canonicalLicenseStatus: license?.canonicalStatus || license?.status || null,
    licenseDocumentState: organization.licenseDocumentState || 'NO_LICENSE',
    trialEndsAt: license?.trialEndsAt,
    subscriptionStartedAt: license?.subscriptionStartedAt,
    renewalDate: license?.renewalDate,
    subscriptionEndsAt: license?.subscriptionEndsAt,
    priceAtSubscription: license?.priceAtSubscription ?? null,
    currency: license?.currency,
    billingInterval: license?.billingInterval,
    activeSeatCount: organization.activeMemberCount ?? state?.activeMembers ?? 0,
    maxUsers: state?.maxUsers ?? license?.maxUsers ?? null,
    // Workspace slug is an allowlisted organization-root identifier.
    platformMetadata: {
      ...(organization.platformMetadata?.workspaceSlug ? { workspaceSlug: organization.platformMetadata.workspaceSlug } : {}),
    },
  };
}

function safeActorRole(value: unknown): OrganizationPlatformAuditItem['actorRole'] {
  return value === 'SUPER_ADMIN' || value === 'SUPPORT' || value === 'ORGANIZATION_ADMIN' ? value : undefined;
}

function safeAuditItem(id: string, data: Record<string, unknown>): OrganizationPlatformAuditItem | null {
  const action = typeof data.action === 'string' ? data.action : '';
  if (!ORGANIZATION_PLATFORM_AUDIT_ACTIONS.has(action)) return null;
  return {
    id,
    action,
    actorRole: safeActorRole(data.actorRole),
    createdAt: isoDate(data.createdAt),
  };
}

async function listOrganizationPlatformAuditHistory(organizationId: string, limit = 50) {
  const snapshot = await adminDb.collection('platformAuditLogs')
    .where('organizationId', '==', organizationId)
    .orderBy('createdAt', 'desc')
    .limit(Math.min(Math.max(limit, 1), 100))
    .get();
  return snapshot.docs
    .map((item) => safeAuditItem(item.id, item.data()))
    .filter((item): item is OrganizationPlatformAuditItem => item !== null)
    .sort((left, right) => (timestampMillis(right.createdAt) || 0) - (timestampMillis(left.createdAt) || 0));
}

/**
 * Bounded Customers & Organizations page. Root documents are cursor-paged by
 * document ID and only the scanned window is hydrated. Server-side filtering
 * avoids copying the full registry into the browser or requiring new indexes.
 */
export async function listOrganizationRegistryPage(
  requestedFilters: OrganizationRegistryFilters = {},
  requestedCursor?: string,
): Promise<OrganizationRegistryPage> {
  const filters = parseOrganizationRegistryFilters(requestedFilters);
  const cursor = paginationCursor(requestedCursor, 'organization pagination cursor');
  const scanLimit = hasRegistryFilters(filters) ? REGISTRY_SCAN_CAP + 1 : REGISTRY_PAGE_SIZE + 1;
  const [rawPlans, snapshot] = await Promise.all([
    listSubscriptionPlans(),
    (() => {
      let query = adminDb.collection('organizations').orderBy(FieldPath.documentId()).limit(scanLimit);
      if (cursor) query = query.startAfter(cursor);
      return query.get();
    })(),
  ]);
  const plans = planLookup(rawPlans as ConsoleSubscriptionPlan[]);
  const candidates = snapshot.docs.slice(0, scanLimit - 1);
  const items: OrganizationRegistryEntry[] = [];
  let scanned = 0;
  let lastScannedCursor: string | undefined;
  const now = Date.now();

  for (let offset = 0; offset < candidates.length && items.length < REGISTRY_PAGE_SIZE; offset += REGISTRY_PAGE_SIZE) {
    const batch = candidates.slice(offset, offset + REGISTRY_PAGE_SIZE);
    const views = await Promise.all(batch.map((document) => getConsoleOrganizationView(document)));
    for (let index = 0; index < views.length; index += 1) {
      const record = toRegistryEntry(views[index] as Organization, plans);
      scanned += 1;
      lastScannedCursor = candidates[offset + index]?.id;
      if (registryMatches(record, filters, now)) items.push(record);
      if (items.length === REGISTRY_PAGE_SIZE) break;
    }
  }

  const hasMore = scanned < snapshot.docs.length;
  return {
    items,
    planOptions: [...plans.values()]
      .map((plan) => ({ planId: plan.planId, displayName: plan.displayName }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName)),
    ...(hasMore && lastScannedCursor ? { nextCursor: lastScannedCursor } : {}),
    hasMore,
  };
}

/** Validate membership filters before reading a tenant-scoped member page. */
export function parseOrganizationMembershipFilters(value: OrganizationMembershipFilters = {}) {
  const query = optionalQuery(value.query, 'member search query');
  return {
    ...(query ? { query: query.toLowerCase() } : {}),
    status: enumFilter(value.status, MEMBER_STATUSES, 'member status'),
  };
}

function toConsoleMembership(snapshot: DocumentSnapshot, organization: OrganizationRegistryEntry): ConsoleMembership {
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    userId: typeof data.userId === 'string' ? data.userId : snapshot.id,
    name: typeof data.name === 'string' ? data.name : undefined,
    // Email is intentionally allowlisted only for platform membership operations.
    email: typeof data.email === 'string' ? data.email : undefined,
    organization: organization.organizationName,
    organizationId: organization.organizationId,
    role: data.role === 'ADMIN' || data.role === 'MANAGER' ? data.role : 'USER',
    status: memberStatus(data.status),
    licenseStatus: organization.licenseStatus,
    organizationHealth: organization.platformStatus,
    activeMemberCount: organization.activeSeatCount,
    maxUsers: organization.maxUsers,
    joinedAt: isoDate(data.joinedAt || data.createdAt),
    lastLogin: isoDate(data.lastLogin),
    lastLoginAt: isoDate(data.lastLoginAt || data.lastLogin),
    lastLoginStatus: memberLoginStatus(data.lastLoginStatus),
    lastSuccessfulLoginAt: isoDate(data.lastSuccessfulLoginAt),
    lastFailedLoginAt: isoDate(data.lastFailedLoginAt),
    lastLoginFailureCode: typeof data.lastLoginFailureCode === 'string' ? data.lastLoginFailureCode : undefined,
  };
}

function membershipMatches(row: ConsoleMembership, filters: ReturnType<typeof parseOrganizationMembershipFilters>) {
  const fields = [row.name, row.email, row.role, row.status].filter((value): value is string => Boolean(value));
  return (!filters.query || fields.some((value) => value.toLowerCase().includes(filters.query!)))
    && (filters.status === 'ALL' || row.status === filters.status);
}

function hasMembershipFilters(filters: ReturnType<typeof parseOrganizationMembershipFilters>) {
  return Boolean(filters.query || filters.status !== 'ALL');
}

/**
 * Cursor-paged membership view scoped to one organization. This preserves
 * tenant isolation and prevents a global membership scan in the Console.
 */
export async function listOrganizationMembershipPage(
  organizationId: string,
  requestedFilters: OrganizationMembershipFilters = {},
  requestedCursor?: string,
): Promise<OrganizationMembershipPage> {
  const orgId = validateOrganizationId(organizationId);
  const filters = parseOrganizationMembershipFilters(requestedFilters);
  const cursor = paginationCursor(requestedCursor, 'membership pagination cursor');
  const scanLimit = hasMembershipFilters(filters) ? MEMBERSHIP_SCAN_CAP + 1 : MEMBERSHIP_PAGE_SIZE + 1;
  const [organizationView, rawPlans] = await Promise.all([
    getConsoleOrganizationSummary(orgId),
    listSubscriptionPlans(),
  ]);
  if (!organizationView) throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
  const organization = toRegistryEntry(organizationView as Organization, planLookup(rawPlans as ConsoleSubscriptionPlan[]));
  let query = adminDb.collection('organizations').doc(orgId).collection('members').orderBy(FieldPath.documentId()).limit(scanLimit);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const candidates = snapshot.docs.slice(0, scanLimit - 1);
  const members: ConsoleMembership[] = [];
  let scanned = 0;
  let lastScannedCursor: string | undefined;

  for (const document of candidates) {
    const member = toConsoleMembership(document, organization);
    scanned += 1;
    lastScannedCursor = document.id;
    if (membershipMatches(member, filters)) members.push(member);
    if (members.length === MEMBERSHIP_PAGE_SIZE) break;
  }

  const hasMore = scanned < snapshot.docs.length;
  return {
    organization,
    members,
    ...(hasMore && lastScannedCursor ? { nextCursor: lastScannedCursor } : {}),
    hasMore,
  };
}

/**
 * Read one platform-safe organization record with redacted, relevant audit
 * events. The audit projection intentionally excludes actors' emails, target
 * emails, raw before/after values, and all tenant data.
 */
export async function getOrganizationOperationsDetail(organizationId: string): Promise<OrganizationOperationsDetail> {
  const orgId = validateOrganizationId(organizationId);
  const [organization, rawPlans, auditHistory] = await Promise.all([
    getConsoleOrganizationSummary(orgId),
    listSubscriptionPlans(),
    // The profile is a recent-activity preview; complete history stays in the
    // separately cursor-paged Audit Logs screen.
    listOrganizationPlatformAuditHistory(orgId, 5),
  ]);
  if (!organization) throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
  return {
    organization: toRegistryEntry(organization as Organization, planLookup(rawPlans as ConsoleSubscriptionPlan[])),
    auditHistory,
  };
}
