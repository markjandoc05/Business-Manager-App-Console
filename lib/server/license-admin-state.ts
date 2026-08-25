import { parseCanonicalLicense, resolveCanonicalLicense } from '../license-contract.ts';
import type { LicenseAdminAction, LicenseAdminState, LicenseDocumentState, OrganizationAdminState, OrganizationAttentionReason } from '../types';

const DAY_MS = 86_400_000;

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

function isoDate(value: unknown): string | null {
  const millis = timestampMillis(value);
  return millis === undefined ? null : new Date(millis).toISOString();
}

export function deriveLicenseAdminState(
  raw: Record<string, unknown> | undefined,
  activeMembers: number,
  now = Date.now(),
): LicenseAdminState {
  const parsedLicense = raw === undefined ? null : parseCanonicalLicense(raw);
  const documentState: LicenseDocumentState = raw === undefined
    ? 'NO_LICENSE'
    : parsedLicense ? 'VALID_LICENSE' : 'INVALID_LICENSE';

  if (documentState !== 'VALID_LICENSE') {
    return {
      documentState,
      status: 'UNKNOWN',
      plan: null,
      activeMembers,
      maxUsers: null,
      daysRemaining: null,
      expiresAt: null,
      allowedActions: documentState === 'NO_LICENSE' ? ['ACTIVATE'] : ['REPAIR_LICENSE'],
    };
  }

  const license = parsedLicense!;
  const effective = resolveCanonicalLicense(license, now);
  const expiration = license.status === 'TRIAL' ? license.trialEndsAt : license.subscriptionEndsAt;
  const expirationMillis = timestampMillis(expiration);
  const daysRemaining = expirationMillis === undefined
    ? null
    : Math.max(0, Math.ceil((expirationMillis - now) / DAY_MS));
  const actions: LicenseAdminAction[] = [];

  if (license.status === 'SUSPENDED') {
    actions.push('EDIT_LICENSE_DETAILS');
    if (expirationMillis !== undefined && expirationMillis > now) actions.push('REACTIVATE');
    if (license.plan !== 'TRIAL') actions.push('RENEW');
    actions.push('CHANGE_SEAT_LIMIT');
  } else if (effective.status === 'TRIAL') {
    actions.push('EDIT_LICENSE_DETAILS', 'EXTEND_TRIAL', 'CONVERT_TO_PAID', 'CHANGE_SEAT_LIMIT', 'SUSPEND', 'EXPIRE');
  } else if (effective.status === 'ACTIVE') {
    actions.push('EDIT_LICENSE_DETAILS', 'EXTEND_SUBSCRIPTION', 'RENEW', 'CHANGE_PLAN', 'CHANGE_SEAT_LIMIT', 'SUSPEND', 'EXPIRE');
  } else if (effective.status === 'EXPIRED') {
    actions.push('EDIT_LICENSE_DETAILS');
    if (license.plan === 'TRIAL') actions.push('EXTEND_TRIAL');
    else actions.push('RENEW');
  }

  return {
    documentState,
    status: effective.status,
    plan: license.plan,
    activeMembers,
    maxUsers: license.maxUsers,
    daysRemaining,
    expiresAt: isoDate(expiration),
    allowedActions: actions,
  };
}

export function deriveOrganizationAdminState(
  organizationData: Record<string, unknown>,
  licenseState: LicenseAdminState,
): OrganizationAdminState {
  const reasons: OrganizationAttentionReason[] = [];
  if (licenseState.documentState === 'NO_LICENSE') reasons.push('NO_LICENSE');
  if (licenseState.documentState === 'INVALID_LICENSE') reasons.push('INVALID_LICENSE');
  if (licenseState.status === 'EXPIRED') reasons.push('LICENSE_EXPIRED');
  if (licenseState.status === 'SUSPENDED') reasons.push('LICENSE_SUSPENDED');
  if (licenseState.status === 'ACTIVE' && licenseState.daysRemaining !== null && licenseState.daysRemaining >= 0 && licenseState.daysRemaining <= 30) reasons.push('LICENSE_EXPIRING_SOON');
  if (licenseState.status === 'TRIAL' && licenseState.daysRemaining !== null && licenseState.daysRemaining >= 0 && licenseState.daysRemaining <= 30) reasons.push('TRIAL_EXPIRING_SOON');
  if (licenseState.maxUsers !== null && licenseState.activeMembers > licenseState.maxUsers) reasons.push('SEAT_LIMIT_EXCEEDED');
  if (typeof organizationData.name !== 'string' || !organizationData.name.trim()) reasons.push('MISSING_REQUIRED_ORGANIZATION_DATA');
  if (typeof organizationData.timezone !== 'string' || !organizationData.timezone.trim()) reasons.push('MISSING_TIMEZONE');
  if (typeof organizationData.currency !== 'string' || !organizationData.currency.trim()) reasons.push('MISSING_CURRENCY');
  const hasActionRequiredReason = reasons.some((reason) => !['LICENSE_EXPIRING_SOON', 'TRIAL_EXPIRING_SOON', 'MISSING_TIMEZONE', 'MISSING_CURRENCY'].includes(reason));
  return { health: hasActionRequiredReason ? 'ACTION_REQUIRED' : reasons.length ? 'WARNING' : 'HEALTHY', attentionReasons: reasons };
}
