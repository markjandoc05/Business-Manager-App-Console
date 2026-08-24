import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { buildOrganizationLicenseMirror, canonicalLicensePath, compareOrganizationLicenseMirror, enforcementMirrors, parseCanonicalLicense, resolveCanonicalLicense } from '../lib/license-contract.ts';
import { loadLicenseMirrorState } from '../lib/license-mirror.ts';

const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();
const license = (status, end = future) => ({ plan: status === 'TRIAL' ? 'TRIAL' : 'TEAM', status, maxUsers: 3, features: { crm: true }, trialStartedAt: status === 'TRIAL' ? new Date(Date.now() - 86_400_000).toISOString() : undefined, trialEndsAt: status === 'TRIAL' ? end : undefined, subscriptionStartedAt: status === 'ACTIVE' ? new Date(Date.now() - 86_400_000).toISOString() : undefined, subscriptionEndsAt: status === 'ACTIVE' ? end : undefined });

function fakeFirestore(organizationData, canonicalData, canonicalExists = true) {
  const organizationRef = { collection: () => ({ doc: () => ({ get: async () => ({ exists: canonicalExists, data: () => canonicalData }) }) }), get: async () => ({ exists: true, data: () => organizationData }) };
  return { collection: () => ({ doc: () => organizationRef }) };
}

test('canonical reader path is the nested current license document', () => {
  assert.equal(canonicalLicensePath('org-a'), 'organizations/org-a/license/current');
  assert.match(fs.readFileSync(new URL('../lib/server/console-read-service.ts', import.meta.url), 'utf8'), /collection\('license'\)\.doc\('current'\)/);
  assert.doesNotMatch(fs.readFileSync(new URL('../lib/server/console-read-service.ts', import.meta.url), 'utf8'), /data\.license\b/);
});

test('malformed or missing canonical licenses are safe and non-writable', () => {
  assert.equal(parseCanonicalLicense({ status: 'ACTIVE', plan: 'TEAM' }), null);
  assert.equal(parseCanonicalLicense({ status: 'EXPIRED', plan: 'TEAM', maxUsers: 3, subscriptionEndsAt: 'not-a-date' }), null);
  assert.equal(parseCanonicalLicense({ status: 'SUSPENDED', plan: 'TEAM', maxUsers: 3, features: { crm: 'yes' } }), null);
  assert.equal(resolveCanonicalLicense(null).canWrite, false);
  assert.equal(resolveCanonicalLicense(null).status, 'UNKNOWN');
});

test('ACTIVE, SUSPENDED, and EXPIRED produce the Client App enforcement semantics', () => {
  assert.deepEqual(enforcementMirrors(parseCanonicalLicense(license('ACTIVE')), Date.now()), { licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: parseCanonicalLicense(license('ACTIVE')).subscriptionEndsAt });
  assert.deepEqual(enforcementMirrors(parseCanonicalLicense(license('SUSPENDED')), Date.now()), { licenseStatus: 'SUSPENDED', licenseWriteEnabled: false, licenseExpiresAt: null });
  assert.deepEqual(enforcementMirrors(parseCanonicalLicense(license('EXPIRED')), Date.now()), { licenseStatus: 'EXPIRED', licenseWriteEnabled: false, licenseExpiresAt: null });
});

test('TRIAL expiration overrides status and disables writes', () => {
  const trial = parseCanonicalLicense(license('TRIAL', past));
  const resolved = resolveCanonicalLicense(trial);
  assert.equal(resolved.status, 'EXPIRED');
  assert.equal(resolved.canWrite, false);
});

test('ACTIVE expiration overrides status and disables writes', () => {
  const active = parseCanonicalLicense(license('ACTIVE', past));
  assert.equal(resolveCanonicalLicense(active).status, 'EXPIRED');
  assert.deepEqual(enforcementMirrors(active), { licenseStatus: 'EXPIRED', licenseWriteEnabled: false, licenseExpiresAt: null });
});

test('expiration is inclusive at the exact boundary and denies writes after it', () => {
  const endsAt = new Date('2027-01-01T00:00:00.000Z');
  const active = parseCanonicalLicense(license('ACTIVE', endsAt.toISOString()));
  assert.equal(resolveCanonicalLicense(active, endsAt.getTime()).canWrite, true);
  assert.equal(resolveCanonicalLicense(active, endsAt.getTime() + 1).canWrite, false);
});

test('platform license mutations require trusted server authorization and exclude tenant roles', () => {
  const handler = fs.readFileSync(new URL('../lib/server/license-handler.ts', import.meta.url), 'utf8');
  const auth = fs.readFileSync(new URL('../lib/server/platform-admin.ts', import.meta.url), 'utf8');
  assert.match(handler, /requirePlatformAdminToken\(idToken, \['SUPER_ADMIN'\]\)/);
  assert.match(auth, /verifyIdToken/);
  assert.match(auth, /platformAdmins/);
  assert.match(auth, /status !== 'ACTIVE'/);
  assert.match(auth, /roles\.includes\(data\.role\)/);
});

test('license mutation writes canonical document and organization mirrors in one transaction', () => {
  const service = fs.readFileSync(new URL('../lib/server/license-service.ts', import.meta.url), 'utf8');
  assert.match(service, /organizationRef\.collection\('license'\)\.doc\('current'\)/);
  assert.match(service, /transaction\.set\(licenseRef/);
  assert.match(service, /transaction\.set\(organizationRef, \{ \.\.\.mirrors/);
  assert.match(service, /runTransaction/);
  assert.match(service, /transaction\.set\(auditRef/);
});

test('Phase 2 exposes renewal, status-changing operations, and validation guards', () => {
  const service = fs.readFileSync(new URL('../lib/server/license-service.ts', import.meta.url), 'utf8');
  const handler = fs.readFileSync(new URL('../lib/server/license-handler.ts', import.meta.url), 'utf8');
  assert.match(service, /type Action = 'activate' \| 'renew'/);
  assert.match(service, /subscriptionStartedAt/);
  assert.match(service, /subscriptionEndsAt/);
  assert.match(service, /maxUsers cannot be less than the active member count/);
  assert.match(service, /Only a suspended or expired license can be reactivated/);
  assert.match(service, /Only a trial or active license can be suspended/);
  assert.match(service, /Only a trial or active license can be expired/);
  assert.match(handler, /requirePlatformAdminToken\(idToken, \['SUPER_ADMIN'\]\)/);
});

test('activation rejects ACTIVE licenses and preserves the transactional mutation contract', () => {
  const service = fs.readFileSync(new URL('../lib/server/license-service.ts', import.meta.url), 'utf8');
  assert.match(service, /current\?\.status === 'ACTIVE'/);
  assert.match(service, /An active license must be renewed or changed rather than activated again/);
  assert.match(service, /transaction\.set\(licenseRef/);
  assert.match(service, /transaction\.set\(organizationRef, \{ \.\.\.mirrors/);
  assert.match(service, /transaction\.set\(auditRef/);
});

test('the required organization mirror is derived deterministically, including maxUsers', () => {
  const canonical = parseCanonicalLicense({ ...license('ACTIVE'), maxUsers: 5 });
  const mirror = buildOrganizationLicenseMirror(canonical, Date.now());
  assert.equal(mirror.maxUsers, 5);
  assert.equal(mirror.licenseStatus, 'ACTIVE');
  assert.equal(compareOrganizationLicenseMirror(canonical, mirror).status, 'CONSISTENT');
  assert.equal(compareOrganizationLicenseMirror(canonical, { ...mirror, maxUsers: 3 }).status, 'DRIFTED');
});

test('mirror reader distinguishes missing, invalid, and drifted canonical state', async () => {
  const missing = await loadLicenseMirrorState({ firestore: fakeFirestore({}, {}, false), organizationId: 'org-a' });
  assert.equal(missing.status, 'MISSING_CANONICAL_DOCUMENT');
  const invalid = await loadLicenseMirrorState({ firestore: fakeFirestore({}, { plan: 'TEAM', status: 'ACTIVE' }), organizationId: 'org-a' });
  assert.equal(invalid.status, 'INVALID_CANONICAL_LICENSE');
  const drifted = await loadLicenseMirrorState({ firestore: fakeFirestore({ licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: undefined, maxUsers: 3 }, { ...license('ACTIVE'), maxUsers: 5 }), organizationId: 'org-a' });
  assert.equal(drifted.status, 'DRIFTED');
  assert.deepEqual(drifted.differences.map(({ field }) => field), ['licenseExpiresAt', 'maxUsers']);
});

test('all license mutations use the centralized mirror helper', () => {
  const service = fs.readFileSync(new URL('../lib/server/license-service.ts', import.meta.url), 'utf8');
  assert.match(service, /buildOrganizationLicenseMirror\(canonicalNext/);
  assert.match(service, /transaction\.set\(organizationRef, \{ \.\.\.mirrors/);
});

test('the organization detail action matrix does not offer activation for ACTIVE licenses', () => {
  const detail = fs.readFileSync(new URL('../components/console/OrganizationDetailModule.tsx', import.meta.url), 'utf8');
  assert.match(detail, /evaluation\.status === 'ACTIVE'/);
  assert.match(detail, /\['RENEW', 'CHANGE_PLAN', 'CHANGE_SEAT_LIMIT', 'SUSPEND', 'EXPIRE'\]/);
  assert.match(detail, /evaluation\.status === 'TRIAL'/);
  assert.match(detail, /\['ACTIVATE', 'EXTEND_TRIAL', 'CHANGE_SEAT_LIMIT', 'SUSPEND', 'EXPIRE'\]/);
});

test('409 API errors preserve safe domain messages for the Console client', () => {
  const errors = fs.readFileSync(new URL('../lib/server/api-error-response.ts', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../lib/console-api.ts', import.meta.url), 'utf8');
  assert.match(errors, /error: \{ code: apiError\.code, message: apiError\.message \}/);
  assert.match(client, /payload\.error\?\.message/);
});

test('the Console keeps tenant roles and unauthenticated callers outside platform operations', () => {
  const auth = fs.readFileSync(new URL('../lib/server/platform-admin.ts', import.meta.url), 'utf8');
  const detail = fs.readFileSync(new URL('../components/console/OrganizationDetailModule.tsx', import.meta.url), 'utf8');
  assert.match(auth, /A Firebase ID token is required/);
  assert.match(auth, /platform administrator is not authorized/);
  assert.match(detail, /platformAdmin\?\.role !== 'SUPER_ADMIN'/);
  assert.match(detail, /SUSPEND/);
  assert.match(detail, /EXPIRE/);
});
