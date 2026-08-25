import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin-core';
import { parseCanonicalLicense, resolveCanonicalLicense } from '../license-contract';
import { deriveLicenseAdminState } from './license-admin-state';
import type { OrganizationMemberStatus } from '../types';

function safeDate(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function safeAuditValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(safeAuditValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeAuditValue(item)]));
  return undefined;
}

function memberStatus(value: unknown): OrganizationMemberStatus {
  switch (typeof value === 'string' ? value.toLowerCase() : '') {
    case 'pending': return 'PENDING';
    case 'inactive': return 'INACTIVE';
    case 'suspended': return 'SUSPENDED';
    case 'archived': return 'ARCHIVED';
    case 'disabled': return 'DISABLED';
    default: return 'ACTIVE';
  }
}

function licenseView(raw: Record<string, unknown> | undefined, now = Date.now()) {
  const parsed = raw ? parseCanonicalLicense(raw) : null;
  if (!parsed) return undefined;
  const effective = resolveCanonicalLicense(parsed, now);
  return {
    plan: parsed.plan,
    status: effective.status,
    canonicalStatus: parsed.status,
    maxUsers: parsed.maxUsers,
    features: parsed.features,
    trialStartedAt: safeDate(parsed.trialStartedAt),
    trialEndsAt: safeDate(parsed.trialEndsAt),
    subscriptionStartedAt: safeDate(parsed.subscriptionStartedAt),
    subscriptionEndsAt: safeDate(parsed.subscriptionEndsAt),
    createdAt: safeDate(parsed.createdAt),
    updatedAt: safeDate(parsed.updatedAt),
    updatedBy: parsed.updatedBy,
  };
}

async function organizationView(snapshot: DocumentSnapshot, now = Date.now()) {
  const data = snapshot.data() || {};
  const licenseSnapshot = await snapshot.ref.collection('license').doc('current').get();
  const rawLicense = licenseSnapshot.exists ? licenseSnapshot.data() : undefined;
  const license = licenseView(rawLicense, now);
  const activeMemberCount = await snapshot.ref.collection('members').where('status', '==', 'active').count().get();
  const licenseAdminState = deriveLicenseAdminState(rawLicense, activeMemberCount.data().count, now);
  return {
    id: snapshot.id,
    name: typeof data.name === 'string' ? data.name : 'Unnamed organization',
    slug: typeof data.slug === 'string' ? data.slug : undefined,
    businessType: typeof data.businessType === 'string' ? data.businessType : undefined,
    ownerEmail: typeof data.ownerEmail === 'string' ? data.ownerEmail : undefined,
    status: data.status,
    licenseStatus: licenseAdminState.status,
    licenseWriteEnabled: typeof data.licenseWriteEnabled === 'boolean' ? data.licenseWriteEnabled : undefined,
    licenseExpiresAt: safeDate(data.licenseExpiresAt),
    maxUsers: licenseAdminState.maxUsers ?? undefined,
    createdAt: safeDate(data.createdAt),
    updatedAt: safeDate(data.updatedAt),
    license,
    licenseDocumentState: licenseAdminState.documentState,
    licenseAdminState,
    activeMemberCount: licenseAdminState.activeMembers,
  };
}

export async function listConsoleOrganizations() {
  const snapshot = await adminDb.collection('organizations').get();
  return Promise.all(snapshot.docs.map((item) => organizationView(item)));
}

export async function getConsoleOrganization(orgId: string) {
  const organizationSnapshot = await adminDb.collection('organizations').doc(orgId).get();
  if (!organizationSnapshot.exists) return null;
  const organization = await organizationView(organizationSnapshot);
  const membersSnapshot = await organizationSnapshot.ref.collection('members').get();
  const members = membersSnapshot.docs.map((item) => {
    const data = item.data();
    return {
      id: item.id,
      userId: typeof data.userId === 'string' ? data.userId : item.id,
      name: typeof data.name === 'string' ? data.name : undefined,
      email: typeof data.email === 'string' ? data.email : undefined,
      role: data.role === 'ADMIN' || data.role === 'MANAGER' ? data.role : 'USER',
      status: memberStatus(data.status),
      joinedAt: safeDate(data.joinedAt || data.createdAt),
      lastLogin: safeDate(data.lastLogin),
    };
  });
  return { organization, members };
}

export async function listConsoleMemberships() {
  const organizations = await adminDb.collection('organizations').get();
  const rows = await Promise.all(organizations.docs.map(async (organization) => {
    const view = await organizationView(organization);
    const members = await organization.ref.collection('members').get();
    return members.docs.map((item) => {
      const data = item.data();
      return {
        id: item.id,
        userId: typeof data.userId === 'string' ? data.userId : item.id,
        name: typeof data.name === 'string' ? data.name : undefined,
        email: typeof data.email === 'string' ? data.email : undefined,
        organization: view.name,
        organizationId: view.id,
        role: data.role === 'ADMIN' || data.role === 'MANAGER' ? data.role : 'USER',
        status: memberStatus(data.status),
        licenseStatus: view.licenseStatus,
        joinedAt: safeDate(data.joinedAt || data.createdAt),
      };
    });
  }));
  return rows.flat();
}

export async function listConsoleAuditLogs(limit = 100, cursor?: string) {
  let query = adminDb.collection('platformAuditLogs').orderBy('createdAt', 'desc').limit(Math.min(Math.max(limit, 1), 100));
  if (cursor) {
    const cursorSnapshot = await adminDb.collection('platformAuditLogs').doc(cursor).get();
    if (cursorSnapshot.exists) query = query.startAfter(cursorSnapshot);
  }
  const snapshot = await query.get();
  const items = snapshot.docs.map((item) => {
    const data = item.data();
    return {
      id: item.id,
      action: data.action,
      actorEmail: data.actorEmail,
      actorRole: data.actorRole,
      targetType: data.targetType,
      targetId: data.targetId,
      organizationId: data.organizationId,
      previousValue: safeAuditValue(data.previousValue),
      newValue: safeAuditValue(data.newValue),
      createdAt: safeDate(data.createdAt),
    };
  });
  return { items, nextCursor: snapshot.docs.length === Math.min(Math.max(limit, 1), 100) ? snapshot.docs.at(-1)?.id : undefined };
}
