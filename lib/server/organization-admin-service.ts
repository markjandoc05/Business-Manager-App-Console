import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from './firebase-admin-core';
import { ApiError } from './api-errors';
import { optionalString, requiredString } from './request';
import type { AuthenticatedPlatformAdmin } from './platform-admin';
import { parseCanonicalLicense } from '../license-contract';
import { resolveOrganizationLocaleSettingsFromData } from './organization-locale-settings';

const PROFILE_FIELDS = ['name', 'businessType', 'currency', 'timezone'] as const;
const MEMBER_ROLES = ['ADMIN', 'MANAGER', 'USER'] as const;
const MEMBER_STATUSES = ['active', 'pending', 'inactive', 'suspended', 'archived', 'disabled'] as const;
const CURRENCY_CODES = new Set((Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('currency') || []);

function jsonSafe(value: unknown): unknown {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}

function rejectUnknownFields(body: Record<string, unknown>, allowed: readonly string[]) {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new ApiError('INVALID_REQUEST', `Unsupported field: ${unknown[0]}.`, 400);
}

function profileValue(body: Record<string, unknown>, field: string) {
  const value = body[field];
  if (typeof value !== 'string') throw new ApiError('INVALID_REQUEST', `${field} must be a string.`, 400);
  return value.trim() || null;
}

function validateProfileValue(field: string, value: string | null) {
  if (!value) return;
  if (field === 'timezone') {
    if (!(value === 'UTC' || value.includes('/'))) throw new ApiError('INVALID_REQUEST', 'timezone must be an IANA timezone identifier.', 400);
    try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); } catch { throw new ApiError('INVALID_REQUEST', 'timezone must be an IANA timezone identifier.', 400); }
  }
  if (field === 'currency' && (!/^[A-Z]{3}$/.test(value) || (CURRENCY_CODES.size > 0 && !CURRENCY_CODES.has(value)))) throw new ApiError('INVALID_REQUEST', 'currency must be a valid ISO 4217 currency code.', 400);
}

export async function updateOrganizationProfile(orgId: string, body: Record<string, unknown>, actor: AuthenticatedPlatformAdmin) {
  rejectUnknownFields(body, [...PROFILE_FIELDS, 'reason']);
  const changedFields = PROFILE_FIELDS.filter((field) => body[field] !== undefined);
  if (!changedFields.length) throw new ApiError('INVALID_REQUEST', 'At least one organization profile field is required.', 400);
  if (body.name !== undefined) requiredString(body, 'name');
  for (const field of PROFILE_FIELDS.filter((item) => item !== 'name')) if (body[field] !== undefined) validateProfileValue(field, profileValue(body, field));
  const organizationRef = adminDb.collection('organizations').doc(orgId);
  const settingsRef = organizationRef.collection('settings').doc('settings');
  const auditRef = adminDb.collection('platformAuditLogs').doc();
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(organizationRef);
    const settingsSnapshot = await transaction.get(settingsRef);
    if (!snapshot.exists) throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
    const current = snapshot.data() || {};
    const settingsData = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};
    const localeSettings = resolveOrganizationLocaleSettingsFromData(current, settingsData, orgId);
    const before = {
      name: typeof settingsData.businessName === 'string' ? settingsData.businessName : current.name ?? null,
      businessType: typeof settingsData.businessType === 'string' ? settingsData.businessType : current.businessType ?? null,
      currency: localeSettings.currency,
      timezone: localeSettings.timezone,
    };
    const next = { ...before } as Record<string, unknown>;
    const organizationUpdate: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    const settingsUpdate: Record<string, unknown> = {};
    for (const field of changedFields) {
      const value = field === 'name' ? requiredString(body, field) : profileValue(body, field);
      next[field] = value;
      const settingsField = field === 'name' ? 'businessName' : field;
      const firestoreValue = value === null ? FieldValue.delete() : value;
      settingsUpdate[settingsField] = firestoreValue;
      organizationUpdate[field] = firestoreValue;
    }
    for (const field of changedFields) if (field !== 'name') validateProfileValue(field, next[field] as string | null);
    transaction.set(organizationRef, organizationUpdate, { merge: true });
    transaction.set(settingsRef, settingsUpdate, { merge: true });
    const auditAction = changedFields.length === 1 && changedFields[0] === 'timezone' ? 'ORGANIZATION_TIMEZONE_UPDATED' : changedFields.length === 1 && changedFields[0] === 'currency' ? 'ORGANIZATION_CURRENCY_UPDATED' : 'ORGANIZATION_PROFILE_UPDATED';
    transaction.set(auditRef, {
      action: auditAction, actorUid: actor.uid, actorEmail: actor.email, actorRole: actor.role,
      targetType: 'ORGANIZATION', targetId: orgId, organizationId: orgId,
      previousValue: jsonSafe(before), newValue: jsonSafe(next), metadata: optionalString(body, 'reason') ? { reason: optionalString(body, 'reason') } : {}, createdAt: FieldValue.serverTimestamp(),
    });
    return { organizationId: orgId, before: jsonSafe(before), after: jsonSafe(next), auditLogId: auditRef.id };
  });
}

export async function updateOrganizationMember(orgId: string, memberUid: string, body: Record<string, unknown>, actor: AuthenticatedPlatformAdmin) {
  rejectUnknownFields(body, ['role', 'status', 'reason']);
  if (body.role === undefined && body.status === undefined) throw new ApiError('INVALID_REQUEST', 'A role or status change is required.', 400);
  const nextRole = body.role === undefined ? undefined : typeof body.role === 'string' && MEMBER_ROLES.includes(body.role as never) ? body.role : null;
  const nextStatus = body.status === undefined ? undefined : typeof body.status === 'string' && MEMBER_STATUSES.includes(body.status as never) ? body.status : null;
  if (nextRole === null) throw new ApiError('INVALID_REQUEST', 'role must be ADMIN, MANAGER, or USER.', 400);
  if (nextStatus === null) throw new ApiError('INVALID_REQUEST', 'status must be active, pending, inactive, suspended, archived, or disabled.', 400);
  const organizationRef = adminDb.collection('organizations').doc(orgId);
  const licenseRef = organizationRef.collection('license').doc('current');
  const auditRef = adminDb.collection('platformAuditLogs').doc();
  return adminDb.runTransaction(async (transaction) => {
    const organizationSnapshot = await transaction.get(organizationRef);
    const licenseSnapshot = await transaction.get(licenseRef);
    const membersSnapshot = await transaction.get(organizationRef.collection('members'));
    if (!organizationSnapshot.exists) throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
    const memberSnapshot = membersSnapshot.docs.find((item) => item.id === memberUid || item.data().userId === memberUid);
    if (!memberSnapshot) throw new ApiError('NOT_FOUND', 'Organization member not found.', 404);
    const currentData = memberSnapshot.data();
    const currentRole = MEMBER_ROLES.includes(currentData.role as never) ? currentData.role as typeof MEMBER_ROLES[number] : 'USER';
    const currentStatus = MEMBER_STATUSES.includes(currentData.status as never) ? currentData.status as typeof MEMBER_STATUSES[number] : 'active';
    const resolvedRole = nextRole ?? currentRole;
    const resolvedStatus = nextStatus ?? currentStatus;
    const activeMembers = membersSnapshot.docs.filter((item) => (typeof item.data().status === 'string' ? item.data().status.toLowerCase() : '') === 'active');
    const currentIsActive = currentStatus === 'active';
    if (!currentIsActive && resolvedStatus === 'active') {
      const license = licenseSnapshot.exists ? parseCanonicalLicense(licenseSnapshot.data() || {}) : null;
      if (license && activeMembers.length >= license.maxUsers) throw new ApiError('CONFLICT', 'Organization user limit has been reached.', 409);
    }
    if (currentIsActive && currentRole === 'ADMIN' && (resolvedStatus !== 'active' || resolvedRole !== 'ADMIN')) {
      const otherActiveAdmins = activeMembers.filter((item) => item.id !== memberSnapshot.id && item.data().role === 'ADMIN');
      if (!otherActiveAdmins.length) throw new ApiError('CONFLICT', 'An organization must retain at least one active ADMIN.', 409);
    }
    const before = { role: currentRole, status: currentStatus };
    const after = { role: resolvedRole, status: resolvedStatus };
    transaction.set(memberSnapshot.ref, { role: resolvedRole, status: resolvedStatus, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true });
    const auditAction = nextRole !== undefined && nextRole !== currentRole ? 'ORGANIZATION_MEMBER_ROLE_CHANGED' : resolvedStatus === 'suspended' ? 'ORGANIZATION_MEMBER_SUSPENDED' : currentStatus === 'suspended' && resolvedStatus === 'active' ? 'ORGANIZATION_MEMBER_REACTIVATED' : resolvedStatus === 'archived' ? 'ORGANIZATION_MEMBER_ARCHIVED' : currentStatus === 'archived' && resolvedStatus === 'active' ? 'ORGANIZATION_MEMBER_RESTORED' : 'ORGANIZATION_MEMBER_STATUS_CHANGED';
    transaction.set(auditRef, {
      action: auditAction, actorUid: actor.uid, actorEmail: actor.email, actorRole: actor.role,
      targetType: 'ORGANIZATION_MEMBER', targetId: memberUid, targetUid: memberUid, targetEmail: typeof currentData.email === 'string' ? currentData.email : null, organizationId: orgId,
      previousValue: before, newValue: after, metadata: optionalString(body, 'reason') ? { reason: optionalString(body, 'reason') } : {}, createdAt: FieldValue.serverTimestamp(),
    });
    return { organizationId: orgId, memberUid, before, after, auditLogId: auditRef.id };
  });
}

export async function lookupExistingOrganizationUser(orgId: string, email: string) {
  if (!email.trim()) throw new ApiError('INVALID_REQUEST', 'email is required.', 400);
  const organizationSnapshot = await adminDb.collection('organizations').doc(orgId).get();
  if (!organizationSnapshot.exists) throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
  let authUser;
  try { authUser = await adminAuth.getUserByEmail(email.trim()); } catch { throw new ApiError('NOT_FOUND', 'This user does not yet have a BSM account. Ask the user to sign in or register first before adding them to this organization.', 404); }
  const userSnapshot = await adminDb.collection('users').doc(authUser.uid).get();
  const userData = userSnapshot.data() || {};
  return { uid: authUser.uid, email: authUser.email || email.trim(), name: typeof userData.displayName === 'string' ? userData.displayName : authUser.displayName || '' };
}

export async function addOrganizationMember(orgId: string, body: Record<string, unknown>, actor: AuthenticatedPlatformAdmin) {
  rejectUnknownFields(body, ['email', 'role', 'reason']);
  const email = requiredString(body, 'email');
  const role = typeof body.role === 'string' && MEMBER_ROLES.includes(body.role as never) ? body.role as typeof MEMBER_ROLES[number] : null;
  if (!role) throw new ApiError('INVALID_REQUEST', 'role must be ADMIN, MANAGER, or USER.', 400);
  const existingUser = await lookupExistingOrganizationUser(orgId, email);
  const organizationRef = adminDb.collection('organizations').doc(orgId);
  const licenseRef = organizationRef.collection('license').doc('current');
  const memberRef = organizationRef.collection('members').doc(existingUser.uid);
  const auditRef = adminDb.collection('platformAuditLogs').doc();
  return adminDb.runTransaction(async (transaction) => {
    const organizationSnapshot = await transaction.get(organizationRef);
    const licenseSnapshot = await transaction.get(licenseRef);
    const memberSnapshot = await transaction.get(memberRef);
    const membersSnapshot = await transaction.get(organizationRef.collection('members'));
    if (!organizationSnapshot.exists) throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
    if (memberSnapshot.exists || membersSnapshot.docs.some((item) => item.data().userId === existingUser.uid)) throw new ApiError('CONFLICT', 'This user is already a member of the organization.', 409);
    const activeMembers = membersSnapshot.docs.filter((item) => item.data().status === 'active').length;
    const license = licenseSnapshot.exists ? parseCanonicalLicense(licenseSnapshot.data() || {}) : null;
    if (license && activeMembers >= license.maxUsers) throw new ApiError('CONFLICT', 'Organization user limit has been reached.', 409);
    const now = FieldValue.serverTimestamp();
    transaction.set(memberRef, { userId: existingUser.uid, email: existingUser.email, name: existingUser.name, role, status: 'active', joinedAt: now, createdAt: now, updatedAt: now, updatedBy: actor.uid });
    transaction.set(auditRef, {
      action: 'ORGANIZATION_MEMBER_ADDED', actorUid: actor.uid, actorEmail: actor.email, actorRole: actor.role,
      targetType: 'ORGANIZATION_MEMBER', targetId: existingUser.uid, targetUid: existingUser.uid, targetEmail: existingUser.email, organizationId: orgId,
      previousValue: null, newValue: { userId: existingUser.uid, email: existingUser.email, role, status: 'active' }, metadata: optionalString(body, 'reason') ? { reason: optionalString(body, 'reason') } : {}, createdAt: now,
    });
    return { organizationId: orgId, member: { uid: existingUser.uid, email: existingUser.email, name: existingUser.name, role, status: 'active' }, auditLogId: auditRef.id };
  });
}
