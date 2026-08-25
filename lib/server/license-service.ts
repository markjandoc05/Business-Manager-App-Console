import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin-core';
import { ApiError } from './api-errors';
import { enumValue, integer, isoDate, optionalString } from './request';
import { AuthenticatedPlatformAdmin } from './platform-admin';
import { buildOrganizationLicenseMirror, parseCanonicalLicense, resolveCanonicalLicense } from '../license-contract';
import { deriveLicenseAdminState } from './license-admin-state';

const PLANS = ['TRIAL', 'STARTER', 'TEAM', 'LEGACY'] as const;
export type LicenseMutationAction = 'activate' | 'renew' | 'extend-trial' | 'convert-to-paid' | 'extend-subscription' | 'change-plan' | 'change-seat-limit' | 'suspend' | 'expire' | 'reactivate';
type Action = LicenseMutationAction;
type LicenseData = Record<string, any>;

function auditAction(action: Action) {
  return ({
    activate: 'ORGANIZATION_LICENSE_ACTIVATED', renew: 'ORGANIZATION_LICENSE_RENEWED', 'extend-trial': 'TRIAL_EXTENDED',
    'convert-to-paid': 'ORGANIZATION_TRIAL_CONVERTED_TO_PAID', 'extend-subscription': 'ORGANIZATION_SUBSCRIPTION_EXTENDED',
    'change-plan': 'ORGANIZATION_PLAN_CHANGED', 'change-seat-limit': 'MAX_USERS_CHANGED', suspend: 'ORGANIZATION_LICENSE_SUSPENDED',
    expire: 'ORGANIZATION_LICENSE_EXPIRED', reactivate: 'ORGANIZATION_LICENSE_REACTIVATED',
  } as const)[action];
}

function jsonSafe(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}

function timestampValue(value: unknown) { return value instanceof Timestamp ? value : undefined; }

export async function mutateLicense(orgId: string, action: Action, body: Record<string, unknown>, actor: AuthenticatedPlatformAdmin) {
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(orgId)) throw new ApiError('INVALID_REQUEST', 'Invalid organization ID.', 400);
  const organizationRef = adminDb.collection('organizations').doc(orgId);
  const licenseRef = organizationRef.collection('license').doc('current');
  const auditRef = adminDb.collection('platformAuditLogs').doc();
  return adminDb.runTransaction(async (transaction) => {
    const organizationSnapshot = await transaction.get(organizationRef);
    const licenseSnapshot = await transaction.get(licenseRef);
    const activeMembersSnapshot = await transaction.get(organizationRef.collection('members').where('status', '==', 'active'));
    if (!organizationSnapshot.exists) throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
    const current = licenseSnapshot.exists ? licenseSnapshot.data() || {} : null;
    if (!current && action !== 'activate') throw new ApiError('CONFLICT', 'No canonical license exists for this organization.', 409);
    const currentLicense = current ? parseCanonicalLicense(current) : null;
    if (current && !currentLicense) throw new ApiError('CONFLICT', 'License requires attention.', 409);
    if (current && action === 'activate') {
      if (current.status === 'ACTIVE') throw new ApiError('CONFLICT', 'An active license must be renewed or changed rather than activated again.', 409);
      throw new ApiError('CONFLICT', 'An existing license must be renewed or changed rather than activated again.', 409);
    }
    const now = Timestamp.now();
    const nextLicense: LicenseData = { ...(current || {}) };
    if (currentLicense) {
      const adminState = deriveLicenseAdminState(current as Record<string, unknown>, activeMembersSnapshot.size, now.toMillis());
      const actionNames: Record<Action, string> = {
        activate: 'ACTIVATE', renew: 'RENEW', 'extend-trial': 'EXTEND_TRIAL', 'convert-to-paid': 'CONVERT_TO_PAID',
        'extend-subscription': 'EXTEND_SUBSCRIPTION', 'change-plan': 'CHANGE_PLAN', 'change-seat-limit': 'CHANGE_SEAT_LIMIT',
        suspend: 'SUSPEND', expire: 'EXPIRE', reactivate: 'REACTIVATE',
      };
      if (!adminState.allowedActions.includes(actionNames[action] as never)) throw new ApiError('CONFLICT', 'This licensing action is no longer allowed for the current organization state.', 409);
    }

    if (action === 'activate') {
      const plan = enumValue(body.plan, 'plan', PLANS);
      const maxUsers = integer(body.maxUsers, 'maxUsers', 1);
      if (maxUsers < activeMembersSnapshot.size) throw new ApiError('INVALID_REQUEST', 'maxUsers cannot be less than the active member count.', 400);
      const startAt = plan === 'TRIAL' ? undefined : isoDate(body.subscriptionStartedAt, 'subscriptionStartedAt');
      const endsAt = isoDate(body.endsAt, 'endsAt');
      if (startAt && endsAt <= startAt) throw new ApiError('INVALID_REQUEST', 'endsAt must be after subscriptionStartedAt.', 400);
      if (endsAt <= now.toDate()) throw new ApiError('INVALID_REQUEST', 'endsAt must be in the future.', 400);
      nextLicense.plan = plan; nextLicense.status = plan === 'TRIAL' ? 'TRIAL' : 'ACTIVE'; nextLicense.maxUsers = maxUsers;
      if (plan === 'TRIAL') {
        nextLicense.trialStartedAt = now;
        nextLicense.trialEndsAt = Timestamp.fromDate(endsAt);
        nextLicense.subscriptionStartedAt = null;
        nextLicense.subscriptionEndsAt = null;
      } else {
        if (!startAt) throw new ApiError('INVALID_REQUEST', 'subscriptionStartedAt is required for a non-trial plan.', 400);
        nextLicense.trialStartedAt = null;
        nextLicense.trialEndsAt = null;
        nextLicense.subscriptionStartedAt = Timestamp.fromDate(startAt);
        nextLicense.subscriptionEndsAt = Timestamp.fromDate(endsAt);
      }
      if (!nextLicense.features) nextLicense.features = { crm: true, reports: true, documents: true };
    } else if (action === 'renew') {
      const startAt = isoDate(body.subscriptionStartedAt, 'subscriptionStartedAt');
      const endsAt = isoDate(body.subscriptionEndsAt, 'subscriptionEndsAt');
      const maxUsers = body.maxUsers === undefined ? Number(current?.maxUsers) : integer(body.maxUsers, 'maxUsers', 1);
      if (maxUsers < activeMembersSnapshot.size) throw new ApiError('INVALID_REQUEST', 'maxUsers cannot be less than the active member count.', 400);
      if (endsAt <= startAt) throw new ApiError('INVALID_REQUEST', 'subscriptionEndsAt must be after subscriptionStartedAt.', 400);
      if (endsAt <= now.toDate()) throw new ApiError('INVALID_REQUEST', 'subscriptionEndsAt must be in the future.', 400);
      if (!['ACTIVE', 'EXPIRED', 'SUSPENDED'].includes(current?.status) || currentLicense?.plan === 'TRIAL') throw new ApiError('CONFLICT', 'Only a paid license can be renewed.', 409);
      const plan = enumValue(body.plan ?? current?.plan, 'plan', PLANS);
      if (plan === 'TRIAL') throw new ApiError('INVALID_REQUEST', 'A renewal requires STARTER, TEAM, or LEGACY.', 400);
      nextLicense.plan = plan;
      nextLicense.status = 'ACTIVE'; nextLicense.maxUsers = maxUsers;
      nextLicense.subscriptionStartedAt = Timestamp.fromDate(startAt); nextLicense.subscriptionEndsAt = Timestamp.fromDate(endsAt);
    } else if (action === 'convert-to-paid') {
      if (!currentLicense || currentLicense.status !== 'TRIAL' || resolveCanonicalLicense(currentLicense, now.toMillis()).status !== 'TRIAL') throw new ApiError('CONFLICT', 'Only a current, unexpired trial can be converted to paid.', 409);
      const plan = enumValue(body.plan, 'plan', ['STARTER', 'TEAM', 'LEGACY'] as const);
      const maxUsers = integer(body.maxUsers, 'maxUsers', 1);
      const startAt = isoDate(body.subscriptionStartedAt, 'subscriptionStartedAt');
      const endsAt = isoDate(body.subscriptionEndsAt, 'subscriptionEndsAt');
      if (maxUsers < activeMembersSnapshot.size) throw new ApiError('INVALID_REQUEST', 'maxUsers cannot be less than the active member count.', 400);
      if (endsAt <= startAt) throw new ApiError('INVALID_REQUEST', 'subscriptionEndsAt must be after subscriptionStartedAt.', 400);
      if (endsAt <= now.toDate()) throw new ApiError('INVALID_REQUEST', 'subscriptionEndsAt must be in the future.', 400);
      nextLicense.plan = plan; nextLicense.status = 'ACTIVE'; nextLicense.maxUsers = maxUsers;
      nextLicense.trialStartedAt = null; nextLicense.trialEndsAt = null;
      nextLicense.subscriptionStartedAt = Timestamp.fromDate(startAt); nextLicense.subscriptionEndsAt = Timestamp.fromDate(endsAt);
    } else if (action === 'extend-subscription') {
      if (!currentLicense || currentLicense.plan === 'TRIAL' || currentLicense.status !== 'ACTIVE' || resolveCanonicalLicense(currentLicense, now.toMillis()).status !== 'ACTIVE') throw new ApiError('CONFLICT', 'Only an active paid license can be extended.', 409);
      const endsAt = isoDate(body.subscriptionEndsAt, 'subscriptionEndsAt');
      const currentEndsAt = timestampValue(currentLicense.subscriptionEndsAt)?.toDate();
      if (!currentEndsAt || endsAt <= currentEndsAt) throw new ApiError('INVALID_REQUEST', 'subscriptionEndsAt must be later than the current subscription end date.', 400);
      if (endsAt <= now.toDate()) throw new ApiError('INVALID_REQUEST', 'subscriptionEndsAt must be in the future.', 400);
      nextLicense.subscriptionEndsAt = Timestamp.fromDate(endsAt);
    } else if (action === 'extend-trial') {
      const trialEndsAt = isoDate(body.trialEndsAt, 'trialEndsAt');
      if (trialEndsAt <= new Date()) throw new ApiError('INVALID_REQUEST', 'trialEndsAt must be in the future.', 400);
      if (currentLicense?.plan !== 'TRIAL' || !['TRIAL', 'EXPIRED'].includes(current?.status)) throw new ApiError('CONFLICT', 'Only a trial license can receive a trial extension.', 409);
      const currentTrialEndsAt = timestampValue(currentLicense.trialEndsAt)?.toDate();
      if (currentTrialEndsAt && trialEndsAt <= currentTrialEndsAt) throw new ApiError('INVALID_REQUEST', 'trialEndsAt must be later than the current trial end date.', 400);
      nextLicense.status = 'TRIAL'; nextLicense.plan = 'TRIAL'; nextLicense.trialEndsAt = Timestamp.fromDate(trialEndsAt);
      if (!nextLicense.trialStartedAt) nextLicense.trialStartedAt = now;
    } else if (action === 'change-plan') {
      if (!['TRIAL', 'ACTIVE'].includes(current?.status)) throw new ApiError('CONFLICT', 'Only a trial or active license can change plan.', 409);
      const plan = enumValue(body.plan, 'plan', PLANS);
      if ((current?.status === 'ACTIVE' && plan === 'TRIAL') || (current?.status === 'TRIAL' && plan !== 'TRIAL')) throw new ApiError('INVALID_REQUEST', 'The selected plan is incompatible with the current license status.', 400);
      nextLicense.plan = plan;
    } else if (action === 'change-seat-limit') {
      const maxUsers = integer(body.maxUsers, 'maxUsers', 1);
      if (maxUsers < activeMembersSnapshot.size) throw new ApiError('INVALID_REQUEST', 'maxUsers cannot be less than the active member count.', 400);
      nextLicense.maxUsers = maxUsers;
    } else if (action === 'suspend') {
      if (!['TRIAL', 'ACTIVE'].includes(current?.status)) throw new ApiError('CONFLICT', 'Only a trial or active license can be suspended.', 409);
      nextLicense.status = 'SUSPENDED';
    } else if (action === 'expire') {
      if (!['TRIAL', 'ACTIVE'].includes(current?.status)) throw new ApiError('CONFLICT', 'Only a trial or active license can be expired.', 409);
      nextLicense.status = 'EXPIRED';
    } else if (action === 'reactivate') {
      if (current?.status !== 'SUSPENDED') throw new ApiError('CONFLICT', 'Only a suspended license can be reactivated.', 409);
      const applicableEndsAt = nextLicense.plan === 'TRIAL'
        ? timestampValue(nextLicense.trialEndsAt)?.toDate()
        : timestampValue(nextLicense.subscriptionEndsAt)?.toDate();
      if (applicableEndsAt && applicableEndsAt > now.toDate()) nextLicense.status = nextLicense.plan === 'TRIAL' ? 'TRIAL' : 'ACTIVE';
      else throw new ApiError('CONFLICT', 'The organization has no unexpired trial or subscription to reactivate.', 409);
    }

    const canonicalNext = parseCanonicalLicense(nextLicense);
    if (!canonicalNext) throw new ApiError('INVALID_REQUEST', 'The mutation would produce an invalid canonical license.', 400);
    const mirrors = buildOrganizationLicenseMirror(canonicalNext, now.toMillis());
    nextLicense.updatedAt = FieldValue.serverTimestamp(); nextLicense.updatedBy = actor.uid;
    transaction.set(licenseRef, nextLicense, { merge: true });
    transaction.set(organizationRef, { ...mirrors, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(auditRef, {
      action: auditAction(action), actorUid: actor.uid, actorEmail: actor.email, actorRole: actor.role,
      targetType: 'ORGANIZATION', targetId: orgId, organizationId: orgId,
      previousValue: jsonSafe(current), newValue: jsonSafe({ ...nextLicense, updatedAt: now }),
      metadata: action === 'suspend' ? { reason: optionalString(body, 'reason') } : {}, createdAt: FieldValue.serverTimestamp(),
    });
    return { organizationId: orgId, license: jsonSafe({ ...nextLicense, updatedAt: now }), mirrors: jsonSafe(mirrors), auditLogId: auditRef.id };
  });
}
