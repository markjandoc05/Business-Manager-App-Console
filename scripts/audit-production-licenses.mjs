/*
 * BSM Phase 1B production license audit.
 *
 * This script is intentionally read-only. It uses Application Default
 * Credentials and performs Firestore document/collection reads only.
 * Run it manually from a trusted local terminal after confirming the active
 * gcloud project and ADC account.
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'bsm-client-app-web';
const VALID_LIFECYCLE_STATUSES = ['trial', 'active', 'expired', 'suspended'];
const VALID_LICENSE_PLANS = ['TRIAL', 'SOLO', 'STARTER', 'TEAM', 'LEGACY'];
const VALID_LICENSE_STATUSES = ['TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED'];

if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();

function outputDate(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}

function sameDate(left, right) {
  return outputDate(left) === outputDate(right);
}

function expectedMirrors(license) {
  if (!license) return { licenseStatus: null, licenseWriteEnabled: null, licenseExpiresAt: null };
  const writable = license.status === 'TRIAL' || license.status === 'ACTIVE';
  const expiration = license.status === 'TRIAL' ? license.trialEndsAt : license.subscriptionEndsAt;
  return {
    licenseStatus: license.status,
    licenseWriteEnabled: writable,
    licenseExpiresAt: writable ? outputDate(expiration) : null,
  };
}

function parseLicense(data) {
  if (!data) return { license: null, missingFields: ['document'] };
  const missingFields = [];
  if (!VALID_LICENSE_PLANS.includes(data.plan)) missingFields.push('plan');
  if (!VALID_LICENSE_STATUSES.includes(data.status)) missingFields.push('status');
  if (!Number.isInteger(data.maxUsers) || data.maxUsers < 1) missingFields.push('maxUsers');
  if (!data.features || typeof data.features !== 'object' || Array.isArray(data.features)) missingFields.push('features');

  return {
    license: {
      plan: data.plan ?? null,
      status: data.status ?? null,
      trialStartedAt: outputDate(data.trialStartedAt),
      trialEndsAt: outputDate(data.trialEndsAt),
      subscriptionStartedAt: outputDate(data.subscriptionStartedAt),
      subscriptionEndsAt: outputDate(data.subscriptionEndsAt),
      maxUsers: Number.isInteger(data.maxUsers) ? data.maxUsers : null,
    },
    raw: data,
    missingFields,
  };
}

async function auditOrganization(organizationSnapshot) {
  const organization = organizationSnapshot.data() || {};
  const organizationRef = organizationSnapshot.ref;
  const [licenseSnapshot, membersSnapshot] = await Promise.all([
    organizationRef.collection('license').doc('current').get(),
    organizationRef.collection('members').get(),
  ]);

  const parsed = parseLicense(licenseSnapshot.exists ? licenseSnapshot.data() : null);
  const activeMembers = membersSnapshot.docs.filter((member) => member.data()?.status === 'active').length;
  const license = parsed.license;
  const mirrors = {
    licenseStatus: organization.licenseStatus ?? null,
    licenseWriteEnabled: organization.licenseWriteEnabled ?? null,
    licenseExpiresAt: outputDate(organization.licenseExpiresAt),
  };
  const expected = expectedMirrors(parsed.raw);
  const mirrorMismatches = licenseSnapshot.exists && license
    ? [
        mirrors.licenseStatus !== expected.licenseStatus ? 'licenseStatus' : null,
        mirrors.licenseWriteEnabled !== expected.licenseWriteEnabled ? 'licenseWriteEnabled' : null,
        !sameDate(mirrors.licenseExpiresAt, expected.licenseExpiresAt) ? 'licenseExpiresAt' : null,
      ].filter(Boolean)
    : [];
  const lifecycleStatus = typeof organization.status === 'string' ? organization.status : null;
  const lifecycleConsistency = VALID_LIFECYCLE_STATUSES.includes(lifecycleStatus)
    ? 'VALID_INDEPENDENT_STATUS'
    : 'INCONSISTENT_OR_MISSING_STATUS';

  return {
    organizationId: organizationSnapshot.id,
    organizationName: typeof organization.name === 'string' ? organization.name : null,
    lifecycleStatus,
    canonicalLicenseExists: licenseSnapshot.exists,
    plan: license?.plan ?? null,
    licenseStatus: license?.status ?? null,
    trialStartedAt: license?.trialStartedAt ?? null,
    trialEndsAt: license?.trialEndsAt ?? null,
    subscriptionStartedAt: license?.subscriptionStartedAt ?? null,
    subscriptionEndsAt: license?.subscriptionEndsAt ?? null,
    maxUsers: license?.maxUsers ?? null,
    activeMemberCount: activeMembers,
    mirrors,
    expectedMirrors: licenseSnapshot.exists && license ? expected : null,
    mirrorConsistency: licenseSnapshot.exists && license && mirrorMismatches.length === 0 ? 'MATCH' : 'MISMATCH_OR_UNAVAILABLE',
    mirrorMismatches,
    lifecycleConsistency,
    malformedOrMissingCanonicalFields: parsed.missingFields,
    activeMembersExceedMaxUsers: license?.maxUsers != null && activeMembers > license.maxUsers,
  };
}

const organizationSnapshot = await db.collection('organizations').get();
const organizations = await Promise.all(organizationSnapshot.docs.map(auditOrganization));
const summary = {
  organizationsAudited: organizations.length,
  canonicalLicensesFound: organizations.filter((item) => item.canonicalLicenseExists).length,
  missingCanonicalLicenses: organizations.filter((item) => !item.canonicalLicenseExists).length,
  mirrorMismatches: organizations.filter((item) => item.mirrorConsistency !== 'MATCH').length,
  lifecycleInconsistencies: organizations.filter((item) => item.lifecycleConsistency === 'INCONSISTENT_OR_MISSING_STATUS').length,
  maxUsersViolations: organizations.filter((item) => item.activeMembersExceedMaxUsers).length,
};

console.log(JSON.stringify({ projectId: PROJECT_ID, organizations, summary }, null, 2));
