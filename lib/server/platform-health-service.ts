import { adminAuth, adminDb } from './firebase-admin-core';
import { getPlatformSubscriptionHealthInspection } from './subscription-operations-service';
import { inspectSubscriptionPlanCatalog } from './subscription-plan-service';
import type { PlatformHealthCheck, PlatformHealthData, PlatformHealthStatus, PlatformHealthWarning } from '../types';

type CheckResult<T> = { check: PlatformHealthCheck; value?: T };

function unavailable(id: PlatformHealthCheck['id'], label: string): PlatformHealthCheck {
  return { id, label, status: 'UNAVAILABLE', detail: 'This read-only check could not be completed.' };
}

async function runReadOnlyCheck<T>(
  id: PlatformHealthCheck['id'],
  label: string,
  operation: () => Promise<T>,
  evaluate: (value: T) => Omit<PlatformHealthCheck, 'id' | 'label'>,
): Promise<CheckResult<T>> {
  try {
    const value = await operation();
    return { value, check: { id, label, ...evaluate(value) } };
  } catch {
    return { check: unavailable(id, label) };
  }
}

export function derivePlatformHealthStatus(checks: PlatformHealthCheck[], warnings: PlatformHealthWarning[]): PlatformHealthStatus {
  if (checks.some((check) => check.status === 'UNAVAILABLE')) return 'UNAVAILABLE';
  if (checks.some((check) => check.status === 'DEGRADED') || warnings.length > 0) return 'DEGRADED';
  return 'HEALTHY';
}

/**
 * Read-only platform health projection. It deliberately uses fixed platform
 * collections and canonical services; it does not inspect tenant CRM records,
 * create audit records, or repair any inconsistency.
 */
export async function getPlatformHealth(now = Date.now()): Promise<PlatformHealthData> {
  const backend: PlatformHealthCheck = {
    id: 'CONSOLE_BACKEND',
    label: 'Developer Console backend',
    status: 'HEALTHY',
    detail: 'The trusted Platform Health endpoint responded.',
  };
  const [firestore, firebaseAdminAuth, catalog, subscriptions] = await Promise.all([
    runReadOnlyCheck('FIRESTORE', 'Firestore connectivity', async () => {
      await adminDb.collection('platformPlans').limit(1).get();
    }, () => ({ status: 'HEALTHY', detail: 'A fixed platform collection was read successfully.' })),
    runReadOnlyCheck('FIREBASE_ADMIN_AUTH', 'Firebase Auth / Admin SDK', async () => {
      await adminAuth.listUsers(1);
    }, () => ({ status: 'HEALTHY', detail: 'Firebase Admin Auth completed a read-only availability check.' })),
    runReadOnlyCheck('PLAN_CATALOG', 'Platform plan catalog', inspectSubscriptionPlanCatalog, (inspection) => ({
      status: inspection.available ? 'HEALTHY' : 'DEGRADED',
      detail: inspection.available
        ? 'Required plan configuration is present and valid.'
        : `${inspection.missingPlanIds.length} required plan(s) missing; ${inspection.invalidPlanIds.length} invalid plan configuration(s).`,
    })),
    runReadOnlyCheck('SUBSCRIPTION_LICENSE_SERVICE', 'Canonical subscription / license service', getPlatformSubscriptionHealthInspection, () => ({
      status: 'HEALTHY',
      detail: 'Canonical license, subscription, Founding allocation, and mirror reads completed.',
    })),
  ]);

  const subscriptionData = subscriptions.value;
  const mirrorInspection = subscriptionData?.integrity.mirrors;
  const mirrors: PlatformHealthCheck = mirrorInspection
    ? {
      id: 'LICENSE_MIRRORS',
      label: 'Organization license mirrors',
      status: mirrorInspection.driftedCount === 0 && mirrorInspection.unavailableCanonicalLicenseCount === 0 ? 'HEALTHY' : 'DEGRADED',
      detail: mirrorInspection.unavailableCanonicalLicenseCount > 0
        ? `${mirrorInspection.driftedCount} of ${mirrorInspection.comparableCanonicalLicenseCount} comparable organization mirror(s) are inconsistent; ${mirrorInspection.unavailableCanonicalLicenseCount} organization(s) cannot be compared because their canonical license is missing or invalid.`
        : mirrorInspection.driftedCount === 0
          ? `${mirrorInspection.comparableCanonicalLicenseCount} organization mirror(s) are consistent.`
          : `${mirrorInspection.driftedCount} of ${mirrorInspection.comparableCanonicalLicenseCount} organization mirror(s) are inconsistent.`,
    }
    : unavailable('LICENSE_MIRRORS', 'Organization license mirrors');
  const checks = [backend, firestore.check, firebaseAdminAuth.check, subscriptions.check, catalog.check, mirrors];
  const warnings: PlatformHealthWarning[] = [];
  if (catalog.value?.missingPlanIds.length) {
    warnings.push({
      code: 'PLATFORM_PLAN_MISSING',
      title: 'Required platform plan configuration is missing',
      detail: `${catalog.value.missingPlanIds.length} required plan document(s) are absent from the persisted catalog.`,
      count: catalog.value.missingPlanIds.length,
    });
  }
  if (catalog.value?.invalidPlanIds.length) {
    warnings.push({
      code: 'PLATFORM_PLAN_INVALID',
      title: 'Invalid platform plan configuration detected',
      detail: `${catalog.value.invalidPlanIds.length} persisted plan configuration(s) failed canonical validation.`,
      count: catalog.value.invalidPlanIds.length,
    });
  }

  if (subscriptionData && !subscriptionData.overview.founding100.matches) {
    warnings.push({
      code: 'FOUNDING_100_USAGE_MISMATCH',
      title: 'Founding 100 usage counter mismatch',
      detail: `Canonical usage is ${subscriptionData.overview.founding100.canonicalEligibleCustomerCount}; stored counter is ${subscriptionData.overview.founding100.storedEligibleCustomerCount}; difference is ${subscriptionData.overview.founding100.difference}; configured capacity is ${subscriptionData.overview.founding100.limit}; remaining capacity is ${subscriptionData.overview.founding100.remainingCapacity}.`,
    });
  }
  if (subscriptionData?.overview.founding100.usageExceedsLimit) {
    warnings.push({
      code: 'FOUNDING_CAPACITY_EXCEEDED',
      title: 'Founding canonical usage exceeds the configured capacity',
      detail: `Canonical eligible usage is ${subscriptionData.overview.founding100.canonicalEligibleCustomerCount}; configured capacity is ${subscriptionData.overview.founding100.limit}. No records were changed.`,
    });
  }
  if (subscriptionData) {
    const malformed = subscriptionData.integrity.malformedCanonicalLicenseCount;
    const missing = subscriptionData.integrity.missingCanonicalLicenseCount;
    if (malformed) warnings.push({ code: 'CANONICAL_LICENSE_MALFORMED', title: 'Malformed canonical licenses detected', detail: `${malformed} canonical license document(s) failed validation.`, count: malformed });
    if (missing) warnings.push({ code: 'CANONICAL_LICENSE_MISSING', title: 'Organizations without a canonical license', detail: `${missing} organization(s) have no canonical license document.`, count: missing });
  }
  if (mirrorInspection?.driftedCount) {
    warnings.push({
      code: 'ORGANIZATION_LICENSE_MIRROR_INCONSISTENT',
      title: 'Organization license mirrors are inconsistent',
      detail: `${mirrorInspection.driftedCount} organization mirror(s) differ from canonical license enforcement values.`,
      count: mirrorInspection.driftedCount,
    });
  }

  return {
    status: derivePlatformHealthStatus(checks, warnings),
    checkedAt: new Date(now).toISOString(),
    checks,
    warnings,
    foundingCapacity: subscriptionData
      ? {
        configuredLimit: subscriptionData.overview.founding100.limit,
        canonicalEligibleCustomerCount: subscriptionData.overview.founding100.canonicalEligibleCustomerCount,
        remainingCapacity: subscriptionData.overview.founding100.remainingCapacity,
        storedEligibleCustomerCount: subscriptionData.overview.founding100.storedEligibleCustomerCount,
        difference: subscriptionData.overview.founding100.difference,
        matches: subscriptionData.overview.founding100.matches,
        usageExceedsLimit: subscriptionData.overview.founding100.usageExceedsLimit,
      }
      : null,
    summary: subscriptionData
      ? {
        totalOrganizations: subscriptionData.integrity.totalOrganizations,
        activeLicenses: subscriptionData.overview.activeCount,
        trialLicenses: subscriptionData.overview.trialCount,
        expiredLicenses: subscriptionData.overview.expiredCount,
        suspendedLicenses: subscriptionData.overview.suspendedCount,
      }
      : { totalOrganizations: null, activeLicenses: null, trialLicenses: null, expiredLicenses: null, suspendedLicenses: null },
  };
}
