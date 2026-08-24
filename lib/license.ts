import { Organization, OrganizationLicenseStatus } from './types';
import { resolveCanonicalLicense } from './license-contract';
import type { CanonicalLicense } from './license-contract';

export type EvaluatedLicenseStatus = OrganizationLicenseStatus | 'UNKNOWN';

export interface LicenseEvaluation {
  status: EvaluatedLicenseStatus;
  accessAllowed: boolean;
  warning?: string;
}

export function evaluateOrganizationLicense(organization: Organization, now = new Date()): LicenseEvaluation {
  const license = organization.license;
  if (!license?.status || !license.plan || !license.maxUsers) return { status: 'UNKNOWN', accessAllowed: false, warning: 'The canonical license document is missing or malformed.' };
  const resolved = resolveCanonicalLicense({ plan: license.plan, status: license.status, maxUsers: license.maxUsers, features: license.features || {}, trialStartedAt: license.trialStartedAt, trialEndsAt: license.trialEndsAt, subscriptionStartedAt: license.subscriptionStartedAt, subscriptionEndsAt: license.subscriptionEndsAt, createdAt: license.createdAt, updatedAt: license.updatedAt, updatedBy: license.updatedBy } as CanonicalLicense, now.getTime());
  return {
    status: resolved.status as OrganizationLicenseStatus | 'UNKNOWN',
    accessAllowed: resolved.canWrite,
    warning: resolved.reason === 'missing' ? 'The canonical license document is missing.' : resolved.reason === 'expired' ? 'The license has expired.' : undefined,
  };
}

export function licenseStatusClasses(status: EvaluatedLicenseStatus) {
  const classes: Record<string, string> = {
    TRIAL: 'bg-violet-50 text-violet-700 border-violet-200',
    ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    EXPIRED: 'bg-rose-50 text-rose-700 border-rose-200',
    SUSPENDED: 'bg-slate-100 text-slate-700 border-slate-300',
    UNKNOWN: 'bg-gray-100 text-gray-600 border-gray-200',
  };
  return classes[status] || classes.UNKNOWN;
}
