import { mapConsoleReads, readCollectionPages } from './bounded-console-reads';
import { FieldPath, type DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin-core';
import { ApiError } from './api-errors';
import { parseCanonicalLicense, resolveCanonicalLicense } from '../license-contract';
import { deriveLicenseAdminState, deriveOrganizationAdminState } from './license-admin-state';
import { resolveOrganizationLocaleSettingsFromData } from './organization-locale-settings';
import { validateOrganizationId } from './request';
import type { OrganizationPlatformMetadata, PlatformAuditActorRole, PlatformAuditLogFilters, PlatformAuditLogItem, PlatformAuditLogPage, PlatformAuditResult } from '../types';

function safeDate(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function safeToken(value: unknown, pattern: RegExp, maxLength = 128): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength && pattern.test(normalized) ? normalized : undefined;
}

/** Project only allowlisted organization-root metadata. */
function platformMetadata(data: Record<string, unknown>): OrganizationPlatformMetadata {
  return {
    workspaceSlug: safeToken(data.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/i, 96),
  };
}

function subscriptionStatus(raw: Record<string, unknown>, now = Date.now()): 'trialing' | 'active' | 'expired' | 'cancelled' | undefined {
  const value = raw.subscriptionStatus;
  if (value !== 'trialing' && value !== 'active' && value !== 'expired' && value !== 'cancelled') return undefined;
  if (value === 'trialing' || value === 'active') {
    const end = value === 'trialing' ? raw.trialEndsAt : raw.subscriptionEndsAt;
    const endMillis = end && typeof end === 'object' && 'toMillis' in end && typeof end.toMillis === 'function'
      ? end.toMillis()
      : typeof end === 'string' ? Date.parse(end) : end instanceof Date ? end.getTime() : undefined;
    if (endMillis !== undefined && Number.isFinite(endMillis) && now > endMillis) return 'expired';
  }
  return value;
}

function licenseView(raw: Record<string, unknown> | undefined, now = Date.now()) {
  const parsed = raw ? parseCanonicalLicense(raw) : null;
  if (!parsed) return undefined;
  const effective = resolveCanonicalLicense(parsed, now);
  return {
    organizationId: typeof raw?.organizationId === 'string' ? raw.organizationId : undefined,
    planId: typeof raw?.planId === 'string' ? raw.planId : undefined,
    entitlementTier: parsed.entitlementTier,
    plan: parsed.plan,
    status: effective.status,
    canonicalStatus: parsed.status,
    subscriptionStatus: raw ? subscriptionStatus(raw, now) : undefined,
    maxUsers: parsed.maxUsers,
    features: parsed.features,
    trialStartedAt: safeDate(parsed.trialStartedAt),
    trialEndsAt: safeDate(parsed.trialEndsAt),
    subscriptionStartedAt: safeDate(parsed.subscriptionStartedAt),
    subscriptionEndsAt: safeDate(parsed.subscriptionEndsAt),
    renewalDate: safeDate(raw?.renewalDate),
    priceAtSubscription: typeof raw?.priceAtSubscription === 'number' ? raw.priceAtSubscription : null,
    currency: typeof raw?.currency === 'string' ? raw.currency : undefined,
    billingInterval: typeof raw?.billingInterval === 'string' ? raw.billingInterval : undefined,
    createdAt: safeDate(parsed.createdAt),
    updatedAt: safeDate(parsed.updatedAt),
    updatedBy: parsed.updatedBy,
  };
}

/**
 * Builds the allowlisted organization projection from a root snapshot.
 * Callers that already hold a bounded root page use this to avoid rereading
 * the organization document.
 */
export async function getConsoleOrganizationView(snapshot: DocumentSnapshot, now = Date.now()) {
  const data = snapshot.data() || {};
  const [licenseSnapshot, settingsSnapshot, activeMemberCount] = await Promise.all([
    snapshot.ref.collection('license').doc('current').get(),
    snapshot.ref.collection('settings').doc('settings').get(),
    snapshot.ref.collection('members').where('status', '==', 'active').count().get(),
  ]);
  const settingsData = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};
  const localeSettings = resolveOrganizationLocaleSettingsFromData(data, settingsData, snapshot.id);
  const rawLicense = licenseSnapshot.exists ? licenseSnapshot.data() : undefined;
  const license = licenseView(rawLicense, now);
  const licenseAdminState = deriveLicenseAdminState(rawLicense, activeMemberCount.data().count, now);
  const organizationAdminState = deriveOrganizationAdminState({ ...data, timezone: localeSettings.timezone, currency: localeSettings.currency }, licenseAdminState);
  return {
    id: snapshot.id,
    name: typeof data.name === 'string' ? data.name : 'Unnamed organization',
    slug: typeof data.slug === 'string' ? data.slug : undefined,
    businessType: typeof data.businessType === 'string' ? data.businessType : undefined,
    currency: localeSettings.currency,
    timezone: localeSettings.timezone,
    localeSettings,
    status: data.status,
    planId: license?.planId,
    subscriptionStatus: license?.subscriptionStatus,
    licenseStatus: licenseAdminState.status,
    licenseWriteEnabled: typeof data.licenseWriteEnabled === 'boolean' ? data.licenseWriteEnabled : undefined,
    licenseExpiresAt: safeDate(data.licenseExpiresAt),
    maxUsers: licenseAdminState.maxUsers ?? undefined,
    createdAt: safeDate(data.createdAt) || safeDate(snapshot.createTime),
    updatedAt: safeDate(data.updatedAt),
    platformMetadata: platformMetadata(data),
    license,
    licenseDocumentState: licenseAdminState.documentState,
    licenseAdminState,
    organizationAdminState,
    activeMemberCount: licenseAdminState.activeMembers,
  };
}

export async function listConsoleOrganizations() {
  const snapshots = await readCollectionPages(adminDb.collection('organizations'));
  return mapConsoleReads(snapshots, (item) => getConsoleOrganizationView(item));
}

/**
 * A minimal, cursor-paged organization projection for subscription records.
 * Unlike the general registry read, it does not fetch organization settings or
 * CRM data. It reads only the canonical license and active-seat aggregate for
 * the requested page.
 */
async function subscriptionOrganizationView(snapshot: DocumentSnapshot, now = Date.now()) {
  const data = snapshot.data() || {};
  const [licenseSnapshot, activeMemberCount] = await Promise.all([
    snapshot.ref.collection('license').doc('current').get(),
    snapshot.ref.collection('members').where('status', '==', 'active').count().get(),
  ]);
  const rawLicense = licenseSnapshot.exists ? licenseSnapshot.data() : undefined;
  const license = licenseView(rawLicense, now);
  const licenseAdminState = deriveLicenseAdminState(rawLicense, activeMemberCount.data().count, now);
  return {
    id: snapshot.id,
    name: typeof data.name === 'string' ? data.name : 'Unnamed organization',
    license,
    licenseDocumentState: licenseAdminState.documentState,
    licenseAdminState,
    activeMemberCount: licenseAdminState.activeMembers,
  };
}

/**
 * Bounded cursor page used exclusively by Subscription & License Operations.
 * The cursor is a server-generated organization document ID, ordered by the
 * document key. The extra root document determines whether another page is
 * available without hydrating its nested license or membership data.
 */
export async function listConsoleSubscriptionOrganizationPage(limit = 25, cursor?: string) {
  const safeLimit = Math.min(Math.max(Math.floor(limit) || 25, 1), 50);
  if (cursor !== undefined && (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/.test(cursor))) {
    throw new ApiError('INVALID_REQUEST', 'Invalid subscription pagination cursor.', 400);
  }
  let query = adminDb.collection('organizations').orderBy(FieldPath.documentId()).limit(safeLimit + 1);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const documents = snapshot.docs.slice(0, safeLimit);
  return {
    organizations: await mapConsoleReads(documents, (item) => subscriptionOrganizationView(item)),
    hasMore: snapshot.docs.length > safeLimit,
  };
}

/**
 * The non-member organization projection used by platform registry and
 * subscription views. Keep member reads in the dedicated Users service.
 */
export async function getConsoleOrganizationSummary(orgId: string) {
  validateOrganizationId(orgId);
  const organizationSnapshot = await adminDb.collection('organizations').doc(orgId).get();
  if (!organizationSnapshot.exists) return null;
  return getConsoleOrganizationView(organizationSnapshot);
}

export async function getConsoleOrganization(orgId: string) {
  validateOrganizationId(orgId);
  const organizationSnapshot = await adminDb.collection('organizations').doc(orgId).get();
  if (!organizationSnapshot.exists) return null;
  return { organization: await getConsoleOrganizationView(organizationSnapshot) };
}

const AUDIT_PAGE_MAX = 50;
const AUDIT_SCAN_CAP = 250;
const AUDIT_TOKEN = /^[A-Z][A-Z0-9_]{0,99}$/;
const AUDIT_TARGET_TYPES = new Set(['ORGANIZATION', 'ORGANIZATION_INVITATION', 'ORGANIZATION_LICENSE', 'ORGANIZATION_MEMBER', 'ORGANIZATION_USAGE', 'PLATFORM_ADMIN', 'SUBSCRIPTION_PLAN', 'SUBSCRIPTION_PLAN_CATALOG', 'PLATFORM_EVENT']);
const AUDIT_ACTOR_ROLES = new Set<PlatformAuditActorRole>(['SUPER_ADMIN', 'SUPPORT', 'ORGANIZATION_ADMIN', 'SYSTEM']);
const SAFE_CHANGED_FIELDS = new Map([
  ['displayName', 'display name'], ['price', 'price'], ['currency', 'currency'], ['billingInterval', 'billing interval'], ['trialDays', 'trial duration'], ['noCreditCardRequired', 'card requirement'], ['publicSignup', 'public signup'],
]);

function auditToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  return AUDIT_TOKEN.test(normalized) ? normalized : undefined;
}

function auditTimestamp(value: unknown): { iso?: string; millis?: number } {
  const iso = safeDate(value);
  if (!iso) return {};
  const millis = Date.parse(iso);
  return Number.isFinite(millis) ? { iso: new Date(millis).toISOString(), millis } : {};
}

function auditActorRole(value: unknown): PlatformAuditActorRole {
  return typeof value === 'string' && AUDIT_ACTOR_ROLES.has(value as PlatformAuditActorRole)
    ? value as PlatformAuditActorRole
    : 'SYSTEM';
}

function auditResult(value: unknown): PlatformAuditResult | undefined {
  return value === 'SUCCESS' || value === 'FAILED' || value === 'DENIED' ? value : undefined;
}

function safeAuditOrganizationId(value: unknown) {
  try { return typeof value === 'string' ? validateOrganizationId(value) : undefined; } catch { return undefined; }
}

/** Organization names are already an allowlisted Console registry field. */
function safeAuditOrganizationName(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 160 ? normalized : undefined;
}

function safeAuditTargetId(targetType: string, value: unknown, organizationId?: string) {
  if (targetType === 'SUBSCRIPTION_PLAN' && typeof value === 'string' && /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value)) return value;
  if (['ORGANIZATION', 'ORGANIZATION_LICENSE', 'ORGANIZATION_USAGE'].includes(targetType)) return safeAuditOrganizationId(value) || organizationId;
  if (targetType === 'SUBSCRIPTION_PLAN_CATALOG') return 'catalog';
  return undefined;
}

function auditDetails(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const metadata = value as Record<string, unknown>;
  const details: string[] = [];
  if (Array.isArray(metadata.changedFields)) {
    const changed = metadata.changedFields.filter((field): field is string => typeof field === 'string' && SAFE_CHANGED_FIELDS.has(field)).map((field) => SAFE_CHANGED_FIELDS.get(field));
    if (changed.length) details.push(`Changed: ${changed.join(', ')}`);
  }
  if (metadata.publicSignupChanged === true && typeof metadata.nextPublicSignup === 'boolean') details.push(`Public signup: ${metadata.nextPublicSignup ? 'enabled' : 'disabled'}`);
  if (metadata.marketingChanged === true && (metadata.marketingAction === 'UPDATED' || metadata.marketingAction === 'CLEARED')) details.push(`Plan marketing: ${metadata.marketingAction.toLowerCase()}`);
  if (typeof metadata.planId === 'string' && /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(metadata.planId)) details.push(`Plan: ${metadata.planId}`);
  if (typeof metadata.entitlementTier === 'string' && ['SOLO', 'STARTER', 'TEAM', 'LEGACY'].includes(metadata.entitlementTier)) details.push(`Entitlement: ${metadata.entitlementTier}`);
  if (metadata.provisioning === true) details.push('Workspace provisioning');
  if (metadata.licenseCreated === true) details.push('Canonical license created');
  if (metadata.licenseLinked === true) details.push('License linked to organization');
  if (metadata.registrationReset === true) details.push('Registration reset');
  return details.slice(0, 5);
}

function projectPlatformAuditLog(id: string, data: Record<string, unknown>): PlatformAuditLogItem {
  const action = auditToken(data.action) || 'UNKNOWN';
  const targetType = auditToken(data.targetType);
  const safeTargetType = targetType && AUDIT_TARGET_TYPES.has(targetType) ? targetType : 'PLATFORM_EVENT';
  const organizationId = safeAuditOrganizationId(data.organizationId);
  const timestamp = auditTimestamp(data.createdAt);
  const targetId = safeAuditTargetId(safeTargetType, data.targetId, organizationId);
  const result = auditResult(data.result ?? data.outcome);
  return {
    id,
    action,
    actorRole: auditActorRole(data.actorRole),
    targetType: safeTargetType,
    ...(targetId ? { targetId } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(result ? { result } : {}),
    details: auditDetails(data.metadata),
    ...(timestamp.iso ? { createdAt: timestamp.iso } : {}),
  };
}

function auditDateFilter(value: string | undefined, field: 'dateFrom' | 'dateTo'): number | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError('INVALID_REQUEST', `${field} must be a YYYY-MM-DD date.`, 400);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ApiError('INVALID_REQUEST', `${field} must be a valid date.`, 400);
  }
  return field === 'dateTo' ? date.getTime() + 86_399_999 : date.getTime();
}

function normalizeAuditFilters(filters: PlatformAuditLogFilters = {}) {
  const action = filters.action ? auditToken(filters.action) : undefined;
  const targetType = filters.targetType ? auditToken(filters.targetType) : undefined;
  if (filters.action && !action) throw new ApiError('INVALID_REQUEST', 'Invalid audit action filter.', 400);
  if (filters.targetType && (!targetType || !AUDIT_TARGET_TYPES.has(targetType))) throw new ApiError('INVALID_REQUEST', 'Invalid audit target type filter.', 400);
  const actorRole = filters.actorRole ? auditActorRole(filters.actorRole) : undefined;
  if (filters.actorRole && actorRole !== filters.actorRole) throw new ApiError('INVALID_REQUEST', 'Invalid audit actor role filter.', 400);
  const organizationId = filters.organizationId ? validateOrganizationId(filters.organizationId) : undefined;
  const dateFrom = auditDateFilter(filters.dateFrom, 'dateFrom');
  const dateTo = auditDateFilter(filters.dateTo, 'dateTo');
  if (dateFrom !== undefined && dateTo !== undefined && dateFrom > dateTo) throw new ApiError('INVALID_REQUEST', 'dateFrom must be on or before dateTo.', 400);
  return { action, targetType, actorRole, organizationId, dateFrom, dateTo };
}

function auditMatches(item: PlatformAuditLogItem, createdAt: number | undefined, filters: ReturnType<typeof normalizeAuditFilters>) {
  if (filters.action && item.action !== filters.action) return false;
  if (filters.targetType && item.targetType !== filters.targetType) return false;
  if (filters.actorRole && item.actorRole !== filters.actorRole) return false;
  if (filters.organizationId && item.organizationId !== filters.organizationId) return false;
  if (filters.dateFrom !== undefined && (createdAt === undefined || createdAt < filters.dateFrom)) return false;
  if (filters.dateTo !== undefined && (createdAt === undefined || createdAt > filters.dateTo)) return false;
  return true;
}

function hasAuditFilters(filters: ReturnType<typeof normalizeAuditFilters>) {
  return Boolean(filters.action || filters.targetType || filters.actorRole || filters.organizationId || filters.dateFrom !== undefined || filters.dateTo !== undefined);
}

/**
 * Resolves only the allowlisted organization-root display name for the small
 * audit page being returned. This keeps opaque tenant IDs out of the UI
 * without reading any tenant collections or exposing raw organization data.
 */
async function withAuditOrganizationNames(items: PlatformAuditLogItem[]) {
  const organizationIds = [...new Set(items.flatMap((item) => item.organizationId ? [item.organizationId] : []))];
  if (!organizationIds.length) return items;
  const snapshots = await adminDb.getAll(...organizationIds.map((organizationId) => adminDb.collection('organizations').doc(organizationId)));
  const labels = new Map(snapshots.flatMap((snapshot) => {
    const name = safeAuditOrganizationName(snapshot.data()?.name);
    return name ? [[snapshot.id, name] as const] : [];
  }));
  return items.map((item) => {
    const organizationName = item.organizationId ? labels.get(item.organizationId) : undefined;
    return organizationName ? { ...item, organizationName } : item;
  });
}

/**
 * Bounded, server-side filtered audit read. It scans a fixed maximum window
 * to avoid unbounded browser loading or Firestore index requirements.
 */
export async function listConsoleAuditLogs(limit = 25, cursor?: string, filters: PlatformAuditLogFilters = {}): Promise<PlatformAuditLogPage> {
  const safeLimit = Math.min(Math.max(Math.floor(limit) || 25, 1), AUDIT_PAGE_MAX);
  const normalizedFilters = normalizeAuditFilters(filters);
  // An unfiltered page needs only one extra document to prove whether it has
  // a next cursor. The larger capped window is reserved for client-requested
  // filters that cannot safely rely on a new composite Firestore index.
  const scanLimit = hasAuditFilters(normalizedFilters) ? AUDIT_SCAN_CAP : safeLimit + 1;
  let query = adminDb.collection('platformAuditLogs').orderBy('createdAt', 'desc').limit(scanLimit);
  if (normalizedFilters.organizationId) query = query.where('organizationId', '==', normalizedFilters.organizationId);
  if (cursor) {
    if (cursor.length > 1500 || /[\u0000-\u001f/]/.test(cursor) || cursor === '.' || cursor === '..') throw new ApiError('INVALID_REQUEST', 'Invalid audit cursor.', 400);
    const cursorSnapshot = await adminDb.collection('platformAuditLogs').doc(cursor).get();
    if (!cursorSnapshot.exists) throw new ApiError('INVALID_REQUEST', 'Invalid audit pagination cursor.', 400);
    if (cursorSnapshot.data()?.createdAt === undefined || (normalizedFilters.organizationId && cursorSnapshot.data()?.organizationId !== normalizedFilters.organizationId)) throw new ApiError('INVALID_REQUEST', 'Audit cursor does not belong to this filter.', 400);
    query = query.startAfter(cursorSnapshot);
  }
  const snapshot = await query.get();
  const items: PlatformAuditLogItem[] = [];
  let scanned = 0;
  for (const document of snapshot.docs) {
    scanned += 1;
    const data = document.data() || {};
    const item = projectPlatformAuditLog(document.id, data);
    if (auditMatches(item, auditTimestamp(data.createdAt).millis, normalizedFilters)) items.push(item);
    if (items.length === safeLimit) break;
  }
  const nextCursor = scanned > 0 && (snapshot.docs.length > scanned || (hasAuditFilters(normalizedFilters) && snapshot.docs.length === scanLimit))
    ? snapshot.docs[scanned - 1]?.id
    : undefined;
  const namedItems = await withAuditOrganizationNames(items);
  return { items: namedItems, ...(nextCursor ? { nextCursor } : {}), pageInfo: { hasNextPage: Boolean(nextCursor), hasPreviousPage: Boolean(cursor), ...(nextCursor ? { nextCursor } : {}) } };
}
