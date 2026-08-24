import { Organization, OrganizationLicenseStatus } from './types';

export type EvaluatedLicenseStatus = OrganizationLicenseStatus | 'UNKNOWN';

export interface LicenseEvaluation {
  status: EvaluatedLicenseStatus;
  accessAllowed: boolean;
  warning?: string;
}

export function evaluateOrganizationLicense(organization: Organization, now = new Date()): LicenseEvaluation {
  const license = organization.license;
  if (!license?.status) return { status: 'UNKNOWN', accessAllowed: true, warning: 'No license data has been configured.' };

  const date = (value?: string) => value ? new Date(value) : undefined;
  const trialExpired = license.status === 'TRIAL' && date(license.trialEndsAt) && date(license.trialEndsAt)! < now;
  if (trialExpired) return { status: 'EXPIRED', accessAllowed: false, warning: 'Trial period has ended.' };

  if (license.status === 'PAST_DUE') {
    const graceEndsAt = date(license.graceEndsAt);
    if (graceEndsAt && graceEndsAt >= now) {
      return { status: 'PAST_DUE', accessAllowed: true, warning: `Payment is past due. Grace period ends ${graceEndsAt.toLocaleDateString()}.` };
    }
    return { status: 'EXPIRED', accessAllowed: false, warning: 'Payment grace period has ended.' };
  }

  if (license.status === 'CANCELLED' && date(license.expiresAt) && date(license.expiresAt)! < now) {
    return { status: 'CANCELLED', accessAllowed: false, warning: 'Subscription has ended.' };
  }
  if (license.status === 'EXPIRED' || license.status === 'SUSPENDED') {
    return { status: license.status, accessAllowed: false };
  }
  return { status: license.status, accessAllowed: true };
}

export function licenseStatusClasses(status: EvaluatedLicenseStatus) {
  const classes: Record<string, string> = {
    TRIAL: 'bg-violet-50 text-violet-700 border-violet-200',
    ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    PAST_DUE: 'bg-amber-50 text-amber-700 border-amber-200',
    EXPIRED: 'bg-rose-50 text-rose-700 border-rose-200',
    SUSPENDED: 'bg-slate-100 text-slate-700 border-slate-300',
    CANCELLED: 'bg-gray-100 text-gray-600 border-gray-200',
    UNKNOWN: 'bg-gray-100 text-gray-600 border-gray-200',
  };
  return classes[status] || classes.UNKNOWN;
}
