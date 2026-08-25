import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { enforcementMirrors } from '../lib/license-contract.ts';
import { adminAuth, adminDb } from '../lib/server/firebase-admin-core.ts';
import { handleLicenseMutation } from '../lib/server/license-handler.ts';

const PROJECT_ID = 'demo-bsm-console';
const productionProjectId = 'bsm-client-app-web';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;

if (!firestoreHost || !authHost || projectId !== PROJECT_ID || [firestoreHost, authHost, projectId].some((value) => value?.includes(productionProjectId))) {
  throw new Error('Refusing expiration integration tests without the demo Auth/Firestore emulators.');
}

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let sequence = 0;

const timestamp = (millis) => Timestamp.fromMillis(millis);
const future = (days = 30) => timestamp(Date.now() + days * 86_400_000);
const past = (days = 1) => timestamp(Date.now() - days * 86_400_000);
const id = (prefix) => `${prefix}-${suffix}-${++sequence}`;

async function createAdmin() {
  const uid = id('admin');
  const email = `${uid}@example.test`;
  const password = 'phase3c-test-password';
  await adminAuth.createUser({ uid, email, password });
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  assert.equal(response.ok, true);
  const body = await response.json();
  return { uid, token: body.idToken };
}

async function seedLicense({ status, plan, trialEndsAt = null, subscriptionEndsAt = null }) {
  const organizationId = id('org');
  const organizationRef = adminDb.doc(`organizations/${organizationId}`);
  const license = {
    plan,
    status,
    maxUsers: 3,
    trialStartedAt: plan === 'TRIAL' ? past(10) : null,
    trialEndsAt,
    subscriptionStartedAt: plan === 'TRIAL' ? null : past(10),
    subscriptionEndsAt,
    features: { crm: true, reports: true, documents: true },
    createdAt: timestamp(Date.now()),
    updatedAt: timestamp(Date.now()),
    updatedBy: 'phase3c-test',
  };
  await organizationRef.collection('license').doc('current').set(license);
  await organizationRef.set({ status: 'active', ...enforcementMirrors(license, Date.now()) }, { merge: true });
  return { organizationId, organizationRef, licenseRef: organizationRef.collection('license').doc('current') };
}

async function call(token, organizationId, action, body) {
  try {
    return { status: 200, value: await handleLicenseMutation(token, organizationId, action, body) };
  } catch (error) {
    return { status: error.status || 500, error };
  }
}

async function state(fixture) {
  const [organizationSnapshot, licenseSnapshot] = await Promise.all([fixture.organizationRef.get(), fixture.licenseRef.get()]);
  const organization = organizationSnapshot.data() || {};
  return {
    license: licenseSnapshot.data() || null,
    mirrors: {
      licenseStatus: organization.licenseStatus,
      licenseWriteEnabled: organization.licenseWriteEnabled,
      licenseExpiresAt: organization.licenseExpiresAt,
    },
  };
}

async function auditCount(organizationId) {
  return (await adminDb.collection('platformAuditLogs').where('organizationId', '==', organizationId).get()).size;
}

async function expectRejectedUnchanged(token, fixture, action, body, expectedStatus) {
  const before = await state(fixture);
  const beforeAudits = await auditCount(fixture.organizationId);
  const result = await call(token, fixture.organizationId, action, body);
  assert.equal(result.status, expectedStatus);
  assert.deepEqual(await state(fixture), before);
  assert.equal(await auditCount(fixture.organizationId), beforeAudits);
}

function assertMirrors(current) {
  const expected = enforcementMirrors(current.license, Date.now());
  assert.equal(current.mirrors.licenseStatus, expected.licenseStatus);
  assert.equal(current.mirrors.licenseWriteEnabled, expected.licenseWriteEnabled);
  if (expected.licenseWriteEnabled) {
    const expiration = current.license.status === 'TRIAL' ? current.license.trialEndsAt : current.license.subscriptionEndsAt;
    assert.equal(current.mirrors.licenseExpiresAt.toMillis(), expiration.toMillis());
  } else {
    assert.equal(current.mirrors.licenseExpiresAt, null);
  }
}

test('expired mutation periods are rejected without canonical, mirror, or audit writes', async () => {
  const admin = await createAdmin();
  const activation = await seedLicense({ status: 'EXPIRED', plan: 'TEAM', subscriptionEndsAt: past() });
  await adminDb.collection('platformAdmins').doc(admin.uid).set({ status: 'ACTIVE', role: 'SUPER_ADMIN', email: `${admin.uid}@example.test` });

  await expectRejectedUnchanged(admin.token, activation, 'activate', {
    plan: 'TEAM', maxUsers: 3, subscriptionStartedAt: past(2).toDate().toISOString(), endsAt: past().toDate().toISOString(),
  }, 409);

  const renewal = await seedLicense({ status: 'ACTIVE', plan: 'TEAM', subscriptionEndsAt: future() });
  await expectRejectedUnchanged(admin.token, renewal, 'renew', {
    plan: 'TEAM', maxUsers: 3, subscriptionStartedAt: past(2).toDate().toISOString(), subscriptionEndsAt: past().toDate().toISOString(),
  }, 400);

  const extension = await seedLicense({ status: 'TRIAL', plan: 'TRIAL', trialEndsAt: future() });
  await expectRejectedUnchanged(admin.token, extension, 'extend-trial', { trialEndsAt: past().toDate().toISOString() }, 400);

  const reactivation = await seedLicense({ status: 'SUSPENDED', plan: 'TEAM', subscriptionEndsAt: past() });
  await expectRejectedUnchanged(admin.token, reactivation, 'reactivate', {}, 409);
});

test('valid future mutations and effective expiration mirrors remain consistent', async () => {
  const admin = await createAdmin();
  await adminDb.collection('platformAdmins').doc(admin.uid).set({ status: 'ACTIVE', role: 'SUPER_ADMIN', email: `${admin.uid}@example.test` });

  const activation = await seedLicense({ status: 'EXPIRED', plan: 'TEAM', subscriptionEndsAt: past() });
  let result = await call(admin.token, activation.organizationId, 'renew', {
    plan: 'TEAM', maxUsers: 3, subscriptionStartedAt: future(1).toDate().toISOString(), subscriptionEndsAt: future(365).toDate().toISOString(),
  });
  assert.equal(result.status, 200, result.error?.message);
  assertMirrors(await state(activation));

  const renewal = await seedLicense({ status: 'ACTIVE', plan: 'TEAM', subscriptionEndsAt: future() });
  result = await call(admin.token, renewal.organizationId, 'renew', {
    plan: 'TEAM', maxUsers: 3, subscriptionStartedAt: future(1).toDate().toISOString(), subscriptionEndsAt: future(365).toDate().toISOString(),
  });
  assert.equal(result.status, 200, result.error?.message);
  assertMirrors(await state(renewal));

  const trial = await seedLicense({ status: 'EXPIRED', plan: 'TRIAL', trialEndsAt: past() });
  result = await call(admin.token, trial.organizationId, 'extend-trial', { trialEndsAt: future(14).toDate().toISOString() });
  assert.equal(result.status, 200, result.error?.message);
  assertMirrors(await state(trial));

  const suspended = await seedLicense({ status: 'ACTIVE', plan: 'TEAM', subscriptionEndsAt: future() });
  result = await call(admin.token, suspended.organizationId, 'suspend', { reason: 'test' });
  assert.equal(result.status, 200);
  const suspendedState = await state(suspended);
  assert.equal(suspendedState.mirrors.licenseStatus, 'SUSPENDED');
  assert.equal(suspendedState.mirrors.licenseWriteEnabled, false);
  assert.equal(suspendedState.mirrors.licenseExpiresAt, null);

  const expired = await seedLicense({ status: 'ACTIVE', plan: 'TEAM', subscriptionEndsAt: future() });
  result = await call(admin.token, expired.organizationId, 'expire', {});
  assert.equal(result.status, 200);
  const expiredState = await state(expired);
  assert.equal(expiredState.mirrors.licenseStatus, 'EXPIRED');
  assert.equal(expiredState.mirrors.licenseWriteEnabled, false);
  assert.equal(expiredState.mirrors.licenseExpiresAt, null);

  const wallClockTrial = await seedLicense({ status: 'TRIAL', plan: 'TRIAL', trialEndsAt: past() });
  result = await call(admin.token, wallClockTrial.organizationId, 'extend-trial', { trialEndsAt: future(14).toDate().toISOString() });
  assert.equal(result.status, 200);
  assertMirrors(await state(wallClockTrial));
});
