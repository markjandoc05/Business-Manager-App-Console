export const LICENSE_PLANS = ['TRIAL', 'SOLO', 'STARTER', 'TEAM', 'LEGACY'] as const;
export const LICENSE_STATUSES = ['TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED'] as const;

export const LICENSE_PLAN_CONFIG = {
  SOLO: { maxUsers: 1 },
  STARTER: { maxUsers: 3 },
  TEAM: { maxUsers: 7 },
  // Preserve the existing configured legacy limit.
  LEGACY: { maxUsers: 3 },
} as const;

export type CanonicalLicensePlan = typeof LICENSE_PLANS[number];
export type CanonicalLicenseStatus = typeof LICENSE_STATUSES[number];
export type PaidLicensePlan = Exclude<CanonicalLicensePlan, 'TRIAL'>;

export interface CanonicalLicense {
  plan: CanonicalLicensePlan;
  status: CanonicalLicenseStatus;
  trialStartedAt?: unknown;
  trialEndsAt?: unknown;
  subscriptionStartedAt?: unknown;
  subscriptionEndsAt?: unknown;
  maxUsers: number;
  features: Record<string, boolean>;
  createdAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: string;
}

export const canonicalLicensePath = (organizationId: string) => `organizations/${organizationId}/license/current`;

export function parseCanonicalLicense(data: Record<string, unknown>): CanonicalLicense | null {
  const plan = LICENSE_PLANS.includes(data.plan as CanonicalLicensePlan) ? data.plan as CanonicalLicensePlan : null;
  const status = LICENSE_STATUSES.includes(data.status as CanonicalLicenseStatus) ? data.status as CanonicalLicenseStatus : null;
  if (!plan || !status || typeof data.maxUsers !== 'number' || !Number.isInteger(data.maxUsers) || data.maxUsers < 1) return null;
  const timestampFields = ['trialStartedAt', 'trialEndsAt', 'subscriptionStartedAt', 'subscriptionEndsAt', 'createdAt', 'updatedAt'];
  if (timestampFields.some((field) => data[field] !== undefined && data[field] !== null && timestampMillis(data[field]) === undefined)) return null;
  if (status === 'TRIAL' && plan !== 'TRIAL') return null;
  if (status === 'ACTIVE' && plan === 'TRIAL') return null;
  const trialStartedAt = timestampMillis(data.trialStartedAt);
  const trialEndsAt = timestampMillis(data.trialEndsAt);
  const subscriptionStartedAt = timestampMillis(data.subscriptionStartedAt);
  const subscriptionEndsAt = timestampMillis(data.subscriptionEndsAt);
  if (status === 'TRIAL' && (trialStartedAt === undefined || trialEndsAt === undefined || trialEndsAt <= trialStartedAt)) return null;
  if (status === 'ACTIVE' && (subscriptionStartedAt === undefined || subscriptionEndsAt === undefined || subscriptionEndsAt <= subscriptionStartedAt)) return null;
  if (data.features !== undefined && (data.features === null || typeof data.features !== 'object' || Array.isArray(data.features) || Object.values(data.features as Record<string, unknown>).some((feature) => typeof feature !== 'boolean'))) return null;
  return {
    plan,
    status,
    trialStartedAt: data.trialStartedAt,
    trialEndsAt: data.trialEndsAt,
    subscriptionStartedAt: data.subscriptionStartedAt,
    subscriptionEndsAt: data.subscriptionEndsAt,
    maxUsers: data.maxUsers,
    features: data.features && typeof data.features === 'object' ? data.features as Record<string, boolean> : {},
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
  };
}

function timestampMillis(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : undefined;
  if (typeof value === 'string') {
    const result = Date.parse(value);
    return Number.isNaN(result) ? undefined : result;
  }
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().getTime();
  return undefined;
}

export function applicableLicenseExpiration(license: CanonicalLicense) {
  return license.status === 'TRIAL' ? license.trialEndsAt : license.subscriptionEndsAt;
}

export function resolveCanonicalLicense(license: CanonicalLicense | null, now = Date.now()) {
  if (!license) return { status: 'UNKNOWN' as const, canWrite: false, isReadOnly: true, daysRemaining: null, reason: 'missing' as const };
  if (license.status === 'SUSPENDED') return { status: 'SUSPENDED' as const, canWrite: false, isReadOnly: true, daysRemaining: null, reason: 'suspended' as const };
  if (license.status === 'EXPIRED') return { status: 'EXPIRED' as const, canWrite: false, isReadOnly: true, daysRemaining: 0, reason: 'expired' as const };
  const end = timestampMillis(applicableLicenseExpiration(license));
  if (end !== undefined && now > end) return { status: 'EXPIRED' as const, canWrite: false, isReadOnly: true, daysRemaining: 0, reason: 'expired' as const };
  return {
    status: license.status,
    canWrite: true,
    isReadOnly: false,
    daysRemaining: end === undefined ? null : Math.max(0, Math.ceil((end - now) / 86_400_000)),
    reason: license.status === 'TRIAL' ? 'trial' as const : 'active' as const,
  };
}

export function enforcementMirrors(license: CanonicalLicense, now = Date.now()) {
  const resolved = resolveCanonicalLicense(license, now);
  const end = applicableLicenseExpiration(license);
  return {
    licenseStatus: resolved.status === 'UNKNOWN' ? license.status : resolved.status,
    licenseWriteEnabled: resolved.canWrite,
    licenseExpiresAt: resolved.canWrite ? end : null,
  };
}

export type OrganizationLicenseMirror = ReturnType<typeof enforcementMirrors> & { maxUsers: number };

/** Fields maintained on the organization root for Client App enforcement compatibility. */
export function buildOrganizationLicenseMirror(license: CanonicalLicense, now = Date.now()): OrganizationLicenseMirror {
  return { ...enforcementMirrors(license, now), maxUsers: license.maxUsers };
}

/** Synchronize the existing Client lifecycle field during explicit license actions. */
export function buildOrganizationLicenseState(license: CanonicalLicense, now = Date.now()) {
  const mirrors = buildOrganizationLicenseMirror(license, now);
  const status = ({ TRIAL: 'trial', ACTIVE: 'active', EXPIRED: 'expired', SUSPENDED: 'suspended' } as const)[mirrors.licenseStatus];
  return { ...mirrors, status };
}

export function compareOrganizationLicenseMirror(license: CanonicalLicense | null, organization: Record<string, unknown>, now = Date.now()) {
  if (!license) return { status: 'DRIFTED' as const, differences: [{ field: 'license/current', expected: 'valid canonical license', actual: null }] };
  const expected = buildOrganizationLicenseState(license, now);
  const differences = Object.keys(expected).flatMap((field) => {
    const actual = organization[field];
    const expectedValue = expected[field as keyof typeof expected];
    const expectedMillis = expectedValue && typeof expectedValue === 'object' && 'toMillis' in expectedValue && typeof expectedValue.toMillis === 'function' ? expectedValue.toMillis() : undefined;
    const actualMillis = actual && typeof actual === 'object' && 'toMillis' in actual && typeof actual.toMillis === 'function' ? actual.toMillis() : undefined;
    const sameTimestamp = expectedMillis !== undefined && actualMillis !== undefined
      ? expectedMillis === actualMillis
      : expectedValue === actual;
    return sameTimestamp ? [] : [{ field, expected: expectedValue, actual }];
  });
  return { status: differences.length ? 'DRIFTED' as const : 'CONSISTENT' as const, differences };
}
