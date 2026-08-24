import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { ApiError } from './api-errors';
import { enumValue, integer, isoDate, optionalString } from './request';
import { AuthenticatedPlatformAdmin } from './platform-admin';

const PLANS = ['FREE_TRIAL', 'SOLO', 'TEAM'] as const;
type Plan = typeof PLANS[number];
type License = Record<string, unknown>;
type Action = 'activate' | 'extend-trial' | 'change-plan' | 'change-seat-limit' | 'suspend' | 'reactivate' | 'cancel';

function auditAction(action: Action) {
  return ({ activate: 'ORGANIZATION_LICENSE_ACTIVATED', 'extend-trial': 'TRIAL_EXTENDED', 'change-plan': 'ORGANIZATION_PLAN_CHANGED', 'change-seat-limit': 'SEAT_LIMIT_CHANGED', suspend: 'ORGANIZATION_LICENSE_SUSPENDED', reactivate: 'ORGANIZATION_REACTIVATED', cancel: 'ORGANIZATION_LICENSE_CANCELLED' } as const)[action];
}

function jsonSafe(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}

export async function mutateLicense(orgId: string, action: Action, body: Record<string, unknown>, actor: AuthenticatedPlatformAdmin) {
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(orgId)) throw new ApiError('INVALID_REQUEST', 'Invalid organization ID.', 400);
  const organizationRef = adminDb.collection('organizations').doc(orgId);
  const auditRef = adminDb.collection('platformAuditLogs').doc();
  const result = await adminDb.runTransaction(async (transaction) => {
    const organizationSnapshot = await transaction.get(organizationRef);
    if (!organizationSnapshot.exists) throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
    const data = organizationSnapshot.data() || {};
    const currentLicense = (data.license && typeof data.license === 'object' ? data.license : {}) as License;
    const now = Timestamp.now();
    const nextLicense: License = { ...currentLicense };
    const activeMembersSnapshot = await transaction.get(organizationRef.collection('members').where('status', '==', 'ACTIVE'));

    if (action === 'activate') {
      const planId = enumValue(body.planId, 'planId', PLANS);
      const seatLimit = integer(body.seatLimit, 'seatLimit', activeMembersSnapshot.size);
      const expiresAt = isoDate(body.expiresAt, 'expiresAt');
      nextLicense.planId = planId; nextLicense.status = 'ACTIVE'; nextLicense.seatLimit = seatLimit; nextLicense.startsAt = now; nextLicense.expiresAt = Timestamp.fromDate(expiresAt);
    } else if (action === 'extend-trial') {
      const trialEndsAt = isoDate(body.trialEndsAt, 'trialEndsAt');
      if (trialEndsAt <= new Date()) throw new ApiError('INVALID_REQUEST', 'trialEndsAt must be in the future.', 400);
      nextLicense.status = 'TRIAL'; nextLicense.trialEndsAt = Timestamp.fromDate(trialEndsAt);
      if (!nextLicense.trialStartedAt) nextLicense.trialStartedAt = now;
    } else if (action === 'change-plan') {
      nextLicense.planId = enumValue(body.planId, 'planId', PLANS);
    } else if (action === 'change-seat-limit') {
      nextLicense.seatLimit = integer(body.seatLimit, 'seatLimit', activeMembersSnapshot.size);
    } else if (action === 'suspend') {
      nextLicense.status = 'SUSPENDED';
    } else if (action === 'reactivate') {
      const trialEndsAt = nextLicense.trialEndsAt instanceof Timestamp ? nextLicense.trialEndsAt.toDate() : undefined;
      const expiresAt = nextLicense.expiresAt instanceof Timestamp ? nextLicense.expiresAt.toDate() : undefined;
      const graceEndsAt = nextLicense.graceEndsAt instanceof Timestamp ? nextLicense.graceEndsAt.toDate() : undefined;
      if (trialEndsAt && trialEndsAt > new Date()) nextLicense.status = 'TRIAL';
      else if (expiresAt && expiresAt > new Date()) nextLicense.status = 'ACTIVE';
      else if (graceEndsAt && graceEndsAt > new Date()) nextLicense.status = 'PAST_DUE';
      else throw new ApiError('CONFLICT', 'The organization has no unexpired trial, subscription, or grace period to reactivate.', 409);
    } else if (action === 'cancel') {
      const effectiveAt = optionalString(body, 'effectiveAt');
      nextLicense.status = 'CANCELLED';
      if (effectiveAt) nextLicense.expiresAt = Timestamp.fromDate(isoDate(effectiveAt, 'effectiveAt'));
    }

    nextLicense.updatedAt = FieldValue.serverTimestamp();
    nextLicense.updatedBy = actor.uid;
    const auditLicense = { ...nextLicense, updatedAt: now };
    transaction.set(organizationRef, { license: nextLicense }, { merge: true });
    transaction.set(auditRef, { action: auditAction(action), actorUid: actor.uid, actorEmail: actor.email, actorRole: actor.role, targetType: 'ORGANIZATION', targetId: orgId, organizationId: orgId, previousValue: jsonSafe(currentLicense), newValue: jsonSafe(auditLicense), metadata: action === 'suspend' ? { reason: optionalString(body, 'reason') } : {}, createdAt: FieldValue.serverTimestamp() });
    return { organizationId: orgId, license: jsonSafe(auditLicense), auditLogId: auditRef.id };
  });
  return result;
}
