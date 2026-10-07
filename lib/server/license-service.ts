import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin-core';
import { ApiError } from './api-errors';
import { enumValue, integer, isoDate, optionalString, requiredString, validateOrganizationId } from './request';
import { AuthenticatedPlatformAdmin } from './platform-admin';
import { buildOrganizationLicenseState, LICENSE_PLAN_CONFIG, LICENSE_PLANS, parseCanonicalLicense, resolveCanonicalLicense } from '../license-contract';
import { deriveLicenseAdminState } from './license-admin-state';

export type LicenseMutationAction = 'activate' | 'repair-license' | 'edit-details' | 'renew' | 'extend-trial' | 'convert-to-paid' | 'extend-subscription' | 'change-plan' | 'change-seat-limit' | 'suspend' | 'expire' | 'reactivate';
type Action = LicenseMutationAction;
type LicenseData = Record<string, any>;

function auditAction(action: Action) {
  return ({
    activate: 'ORGANIZATION_LICENSE_ACTIVATED', 'repair-license': 'ORGANIZATION_LICENSE_REPAIRED', 'edit-details': 'ORGANIZATION_LICENSE_ADMIN_CORRECTED', renew: 'ORGANIZATION_LICENSE_RENEWED', 'extend-trial': 'TRIAL_EXTENDED',
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
  validateOrganizationId(orgId);
  const organizationRef = adminDb.collection('organizations').doc(orgId);
  const licenseRef = organizationRef.collection('license').doc('current');
  const auditRef = adminDb.collection('platformAuditLogs').doc();
  return adminDb.runTransaction(async (transaction) => {
    const organizationSnapshot = await transaction.get(organizationRef);
    const licenseSnapshot = await transaction.get(licenseRef);
    const activeMembersSnapshot = await transaction.get(organizationRef.collection('members').where('status', '==', 'active'));
    if (!organizationSnapshot.exists) throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
    if (!['trial', 'active', 'expired', 'suspended'].includes(organizationSnapshot.data()?.status)) throw new ApiError('CONFLICT', 'Organization lifecycle requires attention before changing its license.', 409);
    const current = licenseSnapshot.exists ? licenseSnapshot.data() || {} : null;
    if (!current && !['activate'].includes(action)) throw new ApiError('CONFLICT', 'No canonical license exists for this organization.', 409);
    const currentLicense = current ? parseCanonicalLicense(current) : null;
    if (current && !currentLicense && action !== 'repair-license') throw new ApiError('CONFLICT', 'License requires attention.', 409);
    if (action === 'repair-license' && (!current || currentLicense)) throw new ApiError('CONFLICT', 'The license is no longer invalid and was not repaired.', 409);
    if (current && action === 'activate') {
      if (current.status === 'ACTIVE') throw new ApiError('CONFLICT', 'An active license must be renewed or changed rather than activated again.', 409);
      throw new ApiError('CONFLICT', 'An existing license must be renewed or changed rather than activated again.', 409);
    }
    const now = Timestamp.now();
    let nextLicense: LicenseData = { ...(current || {}) };
    if (currentLicense) {
      const adminState = deriveLicenseAdminState(current as Record<string, unknown>, activeMembersSnapshot.size, now.toMillis());
      const actionNames: Record<Action, string> = {
        activate: 'ACTIVATE', 'repair-license': 'REPAIR_LICENSE', 'edit-details': 'EDIT_LICENSE_DETAILS', renew: 'RENEW', 'extend-trial': 'EXTEND_TRIAL', 'convert-to-paid': 'CONVERT_TO_PAID',
        'extend-subscription': 'EXTEND_SUBSCRIPTION', 'change-plan': 'CHANGE_PLAN', 'change-seat-limit': 'CHANGE_SEAT_LIMIT',
        suspend: 'SUSPEND', expire: 'EXPIRE', reactivate: 'REACTIVATE',
      };
      if (!adminState.allowedActions.includes(actionNames[action] as never)) throw new ApiError('CONFLICT', 'This licensing action is no longer allowed for the current organization state.', 409);
    }

    if (action === 'repair-license') {
      const plan = enumValue(body.plan, 'plan', LICENSE_PLANS);
      const maxUsers = integer(body.maxUsers, 'maxUsers', 1);
      const reason = requiredString(body, 'reason');
      if (maxUsers < activeMembersSnapshot.size) throw new ApiError('INVALID_REQUEST', 'maxUsers cannot be less than the active member count.', 400);
      const startAt = isoDate(plan === 'TRIAL' ? body.trialStartedAt : body.subscriptionStartedAt, plan === 'TRIAL' ? 'trialStartedAt' : 'subscriptionStartedAt');
      const endsAt = isoDate(plan === 'TRIAL' ? body.trialEndsAt : body.subscriptionEndsAt, plan === 'TRIAL' ? 'trialEndsAt' : 'subscriptionEndsAt');
      if (endsAt <= startAt) throw new ApiError('INVALID_REQUEST', 'The license end date must be after the start date.', 400);
      if (endsAt <= now.toDate()) throw new ApiError('INVALID_REQUEST', 'The license end date must be in the future.', 400);
      nextLicense = {
        plan, status: plan === 'TRIAL' ? 'TRIAL' : 'ACTIVE', maxUsers,
        trialStartedAt: plan === 'TRIAL' ? Timestamp.fromDate(startAt) : null,
        trialEndsAt: plan === 'TRIAL' ? Timestamp.fromDate(endsAt) : null,
        subscriptionStartedAt: plan === 'TRIAL' ? null : Timestamp.fromDate(startAt),
        subscriptionEndsAt: plan === 'TRIAL' ? null : Timestamp.fromDate(endsAt),
        features: { crm: true, reports: true, documents: true }, createdAt: timestampValue(current?.createdAt) || now,
      };
    } else if (action === 'edit-details') {
      const unsupported = Object.keys(body).filter((key) => !['plan', 'maxUsers', 'trialStartedAt', 'trialEndsAt', 'subscriptionStartedAt', 'subscriptionEndsAt', 'reason'].includes(key));
      if (unsupported.length) throw new ApiError('INVALID_REQUEST', `Unsupported license correction field: ${unsupported[0]}.`, 400);
      if (!currentLicense) throw new ApiError('CONFLICT', 'Only a valid canonical license can be corrected.', 409);
      requiredString(body, 'reason');
      const plan = body.plan === undefined ? currentLicense.plan : enumValue(body.plan, 'plan', LICENSE_PLANS);
      const effectiveCurrentStatus = resolveCanonicalLicense(currentLicense, now.toMillis()).status;
      if (body.plan !== undefined && !['TRIAL', 'ACTIVE'].includes(effectiveCurrentStatus)) throw new ApiError('CONFLICT', 'Plan changes for expired or suspended licenses must use the lifecycle renewal controls.', 409);
      if ((currentLicense.status === 'TRIAL' && plan !== 'TRIAL') || (currentLicense.status === 'ACTIVE' && plan === 'TRIAL')) throw new ApiError('INVALID_REQUEST', 'The selected plan is incompatible with the current license status.', 400);
      const maxUsers = body.maxUsers === undefined ? currentLicense.maxUsers : integer(body.maxUsers, 'maxUsers', 1);
      if (maxUsers < activeMembersSnapshot.size) throw new ApiError('INVALID_REQUEST', 'maxUsers cannot be less than the active member count.', 400);
      nextLicense.plan = plan; nextLicense.maxUsers = maxUsers;
      if (plan === 'TRIAL') {
        const startValue = body.trialStartedAt === undefined ? currentLicense.trialStartedAt : body.trialStartedAt;
        const endValue = body.trialEndsAt === undefined ? currentLicense.trialEndsAt : body.trialEndsAt;
        if (body.trialStartedAt !== undefined || body.trialEndsAt !== undefined) {
          const startAt = isoDate(startValue, 'trialStartedAt'); const endsAt = isoDate(endValue, 'trialEndsAt');
          if (endsAt <= startAt) throw new ApiError('INVALID_REQUEST', 'trialEndsAt must be after trialStartedAt.', 400);
        }
        nextLicense.trialStartedAt = startValue; nextLicense.trialEndsAt = endValue; nextLicense.subscriptionStartedAt = null; nextLicense.subscriptionEndsAt = null;
      } else {
        const startValue = body.subscriptionStartedAt === undefined ? currentLicense.subscriptionStartedAt : body.subscriptionStartedAt;
        const endValue = body.subscriptionEndsAt === undefined ? currentLicense.subscriptionEndsAt : body.subscriptionEndsAt;
        if (body.subscriptionStartedAt !== undefined || body.subscriptionEndsAt !== undefined) {
          const startAt = isoDate(startValue, 'subscriptionStartedAt'); const endsAt = isoDate(endValue, 'subscriptionEndsAt');
          if (endsAt <= startAt) throw new ApiError('INVALID_REQUEST', 'subscriptionEndsAt must be after subscriptionStartedAt.', 400);
        }
        nextLicense.trialStartedAt = null; nextLicense.trialEndsAt = null; nextLicense.subscriptionStartedAt = startValue; nextLicense.subscriptionEndsAt = endValue;
      }
    } else if (action === 'activate') {
      const plan = enumValue(body.plan, 'plan', LICENSE_PLANS);
      const maxUsers = integer(body.maxUsers, 'maxUsers', 1);
      if (maxUsers < activeMembersSnapshot.size) throw new ApiError('INVALID_REQUEST', 'maxUsers cannot be less than the active member count.', 400);
      const startAt = plan === 'TRIAL' ? undefined : isoDate(body.subscriptionStartedAt, 'subscriptionStartedAt');
      const endsAt = isoDate(body.endsAt, 'endsAt');
      if (startAt && endsAt <= startAt) throw new ApiError('INVALID_REQUEST', 'endsAt must be after subscriptionStartedAt.', 400);
      if (endsAt <= now.toDate()) throw new ApiError('INVALID_REQUEST', 'endsAt must be in the future.', 400);
      nextLicense.plan = plan; nextLicense.status = plan === 'TRIAL' ? 'TRIAL' : 'ACTIVE'; nextLicense.maxUsers = maxUsers;
      if (plan === 'TRIAL') {
        const trialStartedAt = body.trialStartedAt === undefined ? now.toDate() : isoDate(body.trialStartedAt, 'trialStartedAt');
        if (trialStartedAt >= endsAt) throw new ApiError('INVALID_REQUEST', 'endsAt must be after trialStartedAt.', 400);
        nextLicense.trialStartedAt = Timestamp.fromDate(trialStartedAt);
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
      const plan = enumValue(body.plan ?? current?.plan, 'plan', LICENSE_PLANS);
      if (plan === 'TRIAL') throw new ApiError('INVALID_REQUEST', 'A renewal requires STARTER, TEAM, or LEGACY.', 400);
      nextLicense.plan = plan;
      nextLicense.status = 'ACTIVE'; nextLicense.maxUsers = maxUsers;
      nextLicense.subscriptionStartedAt = Timestamp.fromDate(startAt); nextLicense.subscriptionEndsAt = Timestamp.fromDate(endsAt);
    } else if (action === 'convert-to-paid') {
      if (!currentLicense || currentLicense.status !== 'TRIAL' || resolveCanonicalLicense(currentLicense, now.toMillis()).status !== 'TRIAL') throw new ApiError('CONFLICT', 'Only a current, unexpired trial can be converted to paid.', 409);
      const plan = enumValue(body.plan, 'plan', ['SOLO', 'STARTER', 'TEAM', 'LEGACY'] as const);
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
      if (body.maxUsers !== undefined) throw new ApiError('INVALID_REQUEST', 'maxUsers is derived from the selected plan and cannot be supplied.', 400);
      const plan = enumValue(body.plan, 'plan', LICENSE_PLANS);
      if ((current?.status === 'ACTIVE' && plan === 'TRIAL') || (current?.status === 'TRIAL' && plan !== 'TRIAL')) throw new ApiError('INVALID_REQUEST', 'The selected plan is incompatible with the current license status.', 400);
      if (plan === 'TRIAL') throw new ApiError('INVALID_REQUEST', 'The selected plan is incompatible with the current license status.', 400);
      const maxUsers = LICENSE_PLAN_CONFIG[plan].maxUsers;
      if (maxUsers < activeMembersSnapshot.size) throw new ApiError('CONFLICT', `Cannot change to ${plan} while ${activeMembersSnapshot.size} active users are assigned. Reduce active users to ${maxUsers} before changing plans.`, 409);
      nextLicense.plan = plan;
      nextLicense.maxUsers = maxUsers;
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
    const mirrors = buildOrganizationLicenseState(canonicalNext, now.toMillis());
    nextLicense.updatedAt = FieldValue.serverTimestamp(); nextLicense.updatedBy = actor.uid;
    transaction.set(licenseRef, nextLicense, { merge: true });
    transaction.set(organizationRef, { ...mirrors, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(auditRef, {
      action: auditAction(action), actorUid: actor.uid, actorEmail: actor.email, actorRole: actor.role,
      targetType: 'ORGANIZATION', targetId: orgId, organizationId: orgId,
      previousValue: jsonSafe(current), newValue: jsonSafe({ ...nextLicense, updatedAt: now }),
      metadata: ['suspend', 'repair-license', 'edit-details'].includes(action) ? { reason: optionalString(body, 'reason') } : {}, createdAt: FieldValue.serverTimestamp(),
    });
    return { organizationId: orgId, license: jsonSafe({ ...nextLicense, updatedAt: now }), mirrors: jsonSafe(mirrors), auditLogId: auditRef.id };
  });
}
