import { adminDb } from './firebase-admin-core';
import { parseCanonicalLicense, resolveCanonicalLicense } from '../license-contract';

const SOON_WINDOW_MS = 30 * 86_400_000;

function timestampMillis(value: unknown): number | undefined {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function isEndingSoon(value: unknown, now: number) {
  const timestamp = timestampMillis(value);
  return timestamp !== undefined && timestamp >= now && timestamp - now <= SOON_WINDOW_MS;
}

export async function getDashboardMetrics(now = Date.now()) {
  const organizations = await adminDb.collection('organizations').get();
  let activeMemberships = 0;
  let activeOrganizations = 0;
  let trialOrganizations = 0;
  let expiredOrganizations = 0;
  let suspendedOrganizations = 0;
  let trialsEndingSoon = 0;
  let licensesExpiringSoon = 0;

  await Promise.all(organizations.docs.map(async (organization) => {
    const licenseSnapshot = await organization.ref.collection('license').doc('current').get();
    const rawLicense = licenseSnapshot.exists ? licenseSnapshot.data() : undefined;
    const license = rawLicense ? parseCanonicalLicense(rawLicense) : null;
    const resolved = resolveCanonicalLicense(license, now);

    if (resolved.status === 'ACTIVE') activeOrganizations += 1;
    if (resolved.status === 'TRIAL') trialOrganizations += 1;
    if (resolved.status === 'EXPIRED') expiredOrganizations += 1;
    if (resolved.status === 'SUSPENDED') suspendedOrganizations += 1;
    if (license?.status === 'TRIAL' && isEndingSoon(license.trialEndsAt, now)) trialsEndingSoon += 1;
    if (license?.status === 'ACTIVE' && isEndingSoon(license.subscriptionEndsAt, now)) licensesExpiringSoon += 1;

    const memberCount = await organization.ref.collection('members').where('status', '==', 'active').count().get();
    activeMemberships += memberCount.data().count;
  }));

  return {
    totalOrganizations: organizations.size,
    activeOrganizations,
    trialOrganizations,
    expiredOrganizations,
    suspendedOrganizations,
    activeMemberships,
    trialsEndingSoon,
    licensesExpiringSoon,
  };
}
