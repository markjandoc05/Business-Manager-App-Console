import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';

const EMULATOR_PROJECT_ID = 'demo-bsm-console';
const productionProjectId = 'bsm-client-app-web';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

if (!firestoreHost || !authHost) {
  throw new Error('Refusing to run licensing integration tests: FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST are required.');
}
const identity = resolveFirebaseProjectIdentity();
if (identity.mode !== 'emulator' || identity.projectId !== EMULATOR_PROJECT_ID) {
  throw new Error(`Refusing to run licensing integration tests: project must be ${EMULATOR_PROJECT_ID}.`);
}
if ([firestoreHost, authHost, identity.projectId].some((value) => value.includes(productionProjectId))) {
  throw new Error('Refusing to run licensing integration tests because production project configuration was detected.');
}

const [{ adminAuth, adminDb }, { handleLicenseMutation }] = await Promise.all([
  import('../lib/server/firebase-admin-core.ts'),
  import('../lib/server/license-handler.ts'),
]);
const testSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const organizationId = `license-integration-${testSuffix}`;
const organizationRef = adminDb.collection('organizations').doc(organizationId);
const licenseRef = organizationRef.collection('license').doc('current');
const isoDaysFromNow = (days) => new Date(Date.now() + days * 86_400_000).toISOString();

async function emulatorAuth(operation, email, password) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:${operation}?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Auth emulator ${operation} failed: ${body.error?.message || response.status}`);
  return body;
}

async function createUser(label) {
  const email = `${label}-${testSuffix}@example.test`;
  const password = 'integration-test-password-123';
  return emulatorAuth('signUp', email, password);
}

async function callLicense(token, action, body = {}) {
  try {
    return { status: 200, body: { success: true, data: await handleLicenseMutation(token, organizationId, action, body) } };
  } catch (error) {
    return { status: error.status || 500, body: { success: false, error: { code: error.code, message: error.message } } };
  }
}

async function expectRejected(token, action, body, expectedStatus) {
  const before = await readState();
  const beforeAuditCount = await auditCount();
  const result = await callLicense(token, action, body);
  if (result.status !== expectedStatus) {
    assert.fail(`Expected ${action} to return ${expectedStatus}, received ${result.status}. payload=${JSON.stringify(body)} beforeState=${JSON.stringify(before)} response=${JSON.stringify(result.body)}`);
  }
  assert.equal(result.body.success, false);
  const after = await readState();
  assert.deepEqual(after, before, `rejected ${action} changed license or mirrors`);
  assert.equal(await auditCount(), beforeAuditCount, `rejected ${action} created an audit record`);
}

function comparable(value) {
  if (value && typeof value.toMillis === 'function') return { timestamp: value.toMillis() };
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, comparable(item)]));
  return value;
}

async function readState() {
  const [organizationSnapshot, licenseSnapshot] = await Promise.all([organizationRef.get(), licenseRef.get()]);
  const organization = organizationSnapshot.data() || {};
  return comparable({
    license: licenseSnapshot.data() || null,
    mirrors: {
      licenseStatus: organization.licenseStatus,
      licenseWriteEnabled: organization.licenseWriteEnabled,
      licenseExpiresAt: organization.licenseExpiresAt,
      maxUsers: organization.maxUsers,
    },
  });
}

async function auditCount() {
  return (await adminDb.collection('platformAuditLogs').where('organizationId', '==', organizationId).get()).size;
}

async function auditSnapshot() {
  return adminDb.collection('platformAuditLogs').where('organizationId', '==', organizationId).get();
}

async function expectSuccess(token, action, body, expectedStatus, expectedAuditAction) {
  const beforeAudits = await auditSnapshot();
  const beforeState = await readState();
  const result = await callLicense(token, action, body);
  if (result.status !== expectedStatus) {
    assert.fail(`Expected ${action} to return ${expectedStatus}, received ${result.status}. payload=${JSON.stringify(body)} beforeState=${JSON.stringify(beforeState)} response=${JSON.stringify(result.body)}`);
  }
  assert.equal(result.body.success, true);
  const state = await readState();
  assert.equal(state.license.status, state.mirrors.licenseStatus);
  assert.equal(state.license.maxUsers, state.mirrors.maxUsers);
  assert.equal(state.mirrors.licenseWriteEnabled, state.license.status === 'TRIAL' || state.license.status === 'ACTIVE');
  if (state.mirrors.licenseWriteEnabled) {
    const expectedEnd = state.license.status === 'TRIAL' ? state.license.trialEndsAt : state.license.subscriptionEndsAt;
    assert.deepEqual(state.mirrors.licenseExpiresAt, expectedEnd ? { timestamp: expectedEnd.timestamp } : null);
  } else {
    assert.equal(state.mirrors.licenseExpiresAt, null);
  }
  const audits = await auditSnapshot();
  assert.equal(audits.size, beforeAudits.size + 1);
  const beforeAuditIds = new Set(beforeAudits.docs.map((doc) => doc.id));
  const newAudits = audits.docs.filter((doc) => !beforeAuditIds.has(doc.id));
  assert.equal(newAudits.length, 1);
  assert.equal(newAudits[0].data().action, expectedAuditAction);
  return result;
}

test('Phase 2 licensing routes authorize real emulator callers and preserve atomic state', async () => {
  const superAdmin = await createUser('super-admin');
  const support = await createUser('support');
  const inactive = await createUser('inactive');
  const tenant = await createUser('tenant-admin');

  await organizationRef.set({ name: 'License Integration Organization', status: 'ACTIVE' });
  await organizationRef.collection('members').doc(tenant.localId).set({ uid: tenant.localId, role: 'ADMIN', status: 'active' });
  await organizationRef.collection('members').doc('active-member-2').set({ uid: 'active-member-2', role: 'USER', status: 'active' });
  await adminDb.collection('platformAdmins').doc(superAdmin.localId).set({ status: 'ACTIVE', role: 'SUPER_ADMIN', email: superAdmin.email });
  await adminDb.collection('platformAdmins').doc(support.localId).set({ status: 'ACTIVE', role: 'SUPPORT', email: support.email });
  await adminDb.collection('platformAdmins').doc(inactive.localId).set({ status: 'DISABLED', role: 'SUPER_ADMIN', email: inactive.email });
  await licenseRef.set({
    plan: 'TRIAL', status: 'TRIAL', maxUsers: 2, trialStartedAt: new Date(),
    trialEndsAt: new Date(Date.now() + 30 * 86_400_000), features: { crm: true },
  });
  await organizationRef.set({ licenseStatus: 'TRIAL', licenseWriteEnabled: true, licenseExpiresAt: (await licenseRef.get()).data().trialEndsAt }, { merge: true });

  const start = isoDaysFromNow(1);
  const end = isoDaysFromNow(365);
  const extendedEnd = isoDaysFromNow(500);
  const past = new Date(Date.now() - 60_000).toISOString();
  const extendedTrial = await expectSuccess(superAdmin.idToken, 'extend-trial', { trialEndsAt: isoDaysFromNow(60) }, 200, 'TRIAL_EXTENDED');
  assert.equal(extendedTrial.body.data.license.plan, 'TRIAL');
  assert.equal(extendedTrial.body.data.license.status, 'TRIAL');
  assert.equal(extendedTrial.body.data.mirrors.licenseStatus, 'TRIAL');
  assert.equal(extendedTrial.body.data.mirrors.licenseWriteEnabled, true);
  await expectRejected(superAdmin.idToken, 'activate', { plan: 'TEAM', maxUsers: 2, subscriptionStartedAt: 'not-a-date', endsAt: end }, 409);
  await expectRejected(superAdmin.idToken, 'activate', { plan: 'TEAM', maxUsers: 2, subscriptionStartedAt: start, endsAt: past }, 409);
  await expectRejected(superAdmin.idToken, 'convert-to-paid', { plan: 'INVALID', maxUsers: 2, subscriptionStartedAt: start, subscriptionEndsAt: end }, 400);
  await expectRejected(superAdmin.idToken, 'extend-subscription', { subscriptionEndsAt: end }, 409);
  await expectRejected(superAdmin.idToken, 'renew', { plan: 'TEAM', subscriptionStartedAt: start, subscriptionEndsAt: past }, 409);
  await expectRejected(superAdmin.idToken, 'extend-trial', { trialEndsAt: past }, 400);

  await expectRejected('', 'activate', { plan: 'TEAM', maxUsers: 2, subscriptionStartedAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z' }, 401);
  await expectRejected(tenant.idToken, 'activate', { plan: 'TEAM', maxUsers: 2, subscriptionStartedAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z' }, 403);
  await expectRejected(support.idToken, 'activate', { plan: 'TEAM', maxUsers: 2, subscriptionStartedAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z' }, 403);
  await expectRejected(inactive.idToken, 'activate', { plan: 'TEAM', maxUsers: 2, subscriptionStartedAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z' }, 403);
  await expectRejected('', 'convert-to-paid', { plan: 'TEAM', maxUsers: 2, subscriptionStartedAt: start, subscriptionEndsAt: end }, 401);
  await expectRejected(tenant.idToken, 'convert-to-paid', { plan: 'TEAM', maxUsers: 2, subscriptionStartedAt: start, subscriptionEndsAt: end }, 403);
  await expectRejected(support.idToken, 'convert-to-paid', { plan: 'TEAM', maxUsers: 2, subscriptionStartedAt: start, subscriptionEndsAt: end }, 403);

  const converted = await expectSuccess(superAdmin.idToken, 'convert-to-paid', { plan: 'TEAM', maxUsers: 3, subscriptionStartedAt: start, subscriptionEndsAt: end }, 200, 'ORGANIZATION_TRIAL_CONVERTED_TO_PAID');
  assert.equal(converted.body.data.license.plan, 'TEAM');
  assert.equal(converted.body.data.license.status, 'ACTIVE');
  assert.equal(converted.body.data.license.trialEndsAt, null);
  assert.ok(converted.body.data.license.subscriptionEndsAt);
  const extended = await expectSuccess(superAdmin.idToken, 'extend-subscription', { subscriptionEndsAt: extendedEnd }, 200, 'ORGANIZATION_SUBSCRIPTION_EXTENDED');
  assert.equal(extended.body.data.license.plan, 'TEAM');
  assert.equal(extended.body.data.license.maxUsers, 3);
  assert.equal(extended.body.data.license.subscriptionStartedAt, converted.body.data.license.subscriptionStartedAt);
  await expectRejected('', 'extend-subscription', { subscriptionEndsAt: isoDaysFromNow(600) }, 401);
  await expectRejected(tenant.idToken, 'extend-subscription', { subscriptionEndsAt: isoDaysFromNow(600) }, 403);
  await expectRejected(support.idToken, 'extend-subscription', { subscriptionEndsAt: isoDaysFromNow(600) }, 403);
  await expectRejected(superAdmin.idToken, 'extend-subscription', { subscriptionEndsAt: end }, 400);
  await expectRejected(superAdmin.idToken, 'extend-subscription', { subscriptionEndsAt: extendedEnd }, 400);
  await expectRejected(superAdmin.idToken, 'activate', { plan: 'TEAM', maxUsers: 2, subscriptionStartedAt: start, endsAt: end }, 409);
  await expectSuccess(superAdmin.idToken, 'change-plan', { plan: 'STARTER' }, 200, 'ORGANIZATION_PLAN_CHANGED');
  await expectSuccess(superAdmin.idToken, 'change-plan', { plan: 'LEGACY' }, 200, 'ORGANIZATION_PLAN_CHANGED');
  await expectSuccess(superAdmin.idToken, 'change-plan', { plan: 'TEAM' }, 200, 'ORGANIZATION_PLAN_CHANGED');
  await expectSuccess(superAdmin.idToken, 'suspend', { reason: 'integration test suspension' }, 200, 'ORGANIZATION_LICENSE_SUSPENDED');
  await expectSuccess(superAdmin.idToken, 'reactivate', {}, 200, 'ORGANIZATION_LICENSE_REACTIVATED');
  await expectSuccess(superAdmin.idToken, 'expire', {}, 200, 'ORGANIZATION_LICENSE_EXPIRED');
  await licenseRef.set({ status: 'EXPIRED', subscriptionEndsAt: new Date(Date.now() - 60_000) }, { merge: true });
  await organizationRef.set({ licenseStatus: 'EXPIRED', licenseWriteEnabled: false, licenseExpiresAt: null }, { merge: true });
  await expectRejected(superAdmin.idToken, 'reactivate', {}, 409);
  await expectRejected(superAdmin.idToken, 'activate', { plan: 'TEAM', maxUsers: 2, subscriptionStartedAt: start, endsAt: end }, 409);
  await expectSuccess(superAdmin.idToken, 'renew', { plan: 'TEAM', maxUsers: 3, subscriptionStartedAt: start, subscriptionEndsAt: end }, 200, 'ORGANIZATION_LICENSE_RENEWED');

  await expectSuccess(superAdmin.idToken, 'change-seat-limit', { maxUsers: 4 }, 200, 'MAX_USERS_CHANGED');
  await expectSuccess(superAdmin.idToken, 'change-seat-limit', { maxUsers: 2 }, 200, 'MAX_USERS_CHANGED');
  await expectRejected(superAdmin.idToken, 'change-seat-limit', { maxUsers: 1 }, 400);
  await expectRejected(superAdmin.idToken, 'change-plan', { plan: 'INVALID' }, 400);
  await expectRejected(superAdmin.idToken, 'renew', { plan: 'TEAM', subscriptionStartedAt: end, subscriptionEndsAt: start }, 400);
  await expectRejected(superAdmin.idToken, 'change-plan', { plan: 'TRIAL' }, 400);
  await expectRejected(superAdmin.idToken, 'extend-trial', { trialEndsAt: isoDaysFromNow(120) }, 409);

  await expectSuccess(superAdmin.idToken, 'renew', { plan: 'TEAM', maxUsers: 2, subscriptionStartedAt: start, subscriptionEndsAt: end }, 200, 'ORGANIZATION_LICENSE_RENEWED');

  await adminAuth.getUser(superAdmin.localId);
});
