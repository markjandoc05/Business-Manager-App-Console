import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';

const PROJECT_ID = 'demo-bsm-console';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST || resolveFirebaseProjectIdentity().mode !== 'emulator' || resolveFirebaseProjectIdentity().projectId !== PROJECT_ID) {
  throw new Error('Refusing subscription API integration tests outside the isolated demo Firebase emulators.');
}

const [firebaseCore, planContract] = await Promise.all([
  import('../lib/server/firebase-admin-core.ts'),
  import('../lib/subscription-plan-contract.ts'),
]);

const { adminDb } = firebaseCore;
const { DEFAULT_SUBSCRIPTION_PLANS } = planContract;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const CONSOLE_BASE_URL = process.env.VENTALE_CONSOLE_BASE_URL || 'http://127.0.0.1:3002';

async function callApi(path, { method = 'GET', token, body } = {}) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(new URL(path, CONSOLE_BASE_URL), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function createUser(label) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${label}-${suffix}@example.test`, password: 'subscription-api-test-123', returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'Auth signup failed');
  await adminDb.collection('users').doc(body.localId).set({ uid: body.localId, status: 'active', active: true });
  return body;
}

async function seedSubscriptionLicense({ label, status, planId, subscriptionStatus, subscriptionEndsAt }) {
  const organizationId = `subscription-api-${label}-${suffix}`;
  const organizationRef = adminDb.collection('organizations').doc(organizationId);
  const now = Date.now();
  await organizationRef.set({ name: `Subscription API ${label}` });
  await organizationRef.collection('members').doc('seat-user').set({ userId: 'seat-user', role: 'ADMIN', status: 'active' });
  await organizationRef.collection('license').doc('current').set({
    organizationId,
    planId,
    plan: 'TEAM',
    status,
    subscriptionStatus,
    maxUsers: 3,
    features: { crm: true, reports: true, documents: true },
    trialStartedAt: null,
    trialEndsAt: null,
    subscriptionStartedAt: new Date(now - 86_400_000),
    subscriptionEndsAt,
    renewalDate: subscriptionEndsAt,
    priceAtSubscription: 149,
    currency: 'USD',
    billingInterval: 'year',
    createdAt: new Date(now - 86_400_000),
    updatedAt: new Date(now),
    updatedBy: 'subscription-api-test',
  });
  return organizationId;
}

test('subscription API handlers preserve catalog, tenant, platform, and CRM boundaries', async () => {
  await Promise.all([
    adminDb.collection('platformPlans').doc('founding_100').set(DEFAULT_SUBSCRIPTION_PLANS.founding_100),
    adminDb.collection('platformPlans').doc('standard').set(DEFAULT_SUBSCRIPTION_PLANS.standard),
    adminDb.collection('platformPlanUsage').doc('founding_100').set({ eligibleCustomerCount: 0 }),
  ]);

  let response = await callApi('/api/public/signup-plans');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.map((plan) => plan.planId), ['founding_100']);
  assert.equal('usage' in response.body.data[0], false);

  const tenant = await createUser('tenant-admin');
  const outsider = await createUser('tenant-outsider');
  const organizationId = `subscription-api-org-${suffix}`;
  const organizationRef = adminDb.collection('organizations').doc(organizationId);
  await organizationRef.set({ name: 'Subscription API Organization', crmSensitiveMarker: `crm-root-${suffix}` });
  await organizationRef.collection('members').doc(tenant.localId).set({ userId: tenant.localId, role: 'ADMIN', status: 'active', email: tenant.email });
  await organizationRef.collection('leads').doc('private-lead').set({ marker: `crm-lead-${suffix}` });

  response = await callApi('/api/client/licensing/eligibility', {
    method: 'POST', body: { organizationId, planId: 'founding_100' },
  });
  assert.equal(response.status, 401);

  response = await callApi('/api/client/licensing/eligibility', {
    method: 'POST', token: outsider.idToken, body: { organizationId, planId: 'founding_100' },
  });
  assert.equal(response.status, 403);

  response = await callApi('/api/client/licensing/trial', {
    method: 'POST', token: tenant.idToken, body: { organizationId, planId: 'founding_100', price: 0 },
  });
  assert.equal(response.status, 400);

  response = await callApi('/api/client/licensing/trial', {
    method: 'POST', token: tenant.idToken, body: { organizationId, planId: 'founding_100' },
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.license.status, 'trialing');
  assert.equal(response.body.data.license.priceAtSubscription, 99);

  response = await callApi('/api/client/licensing/link', {
    method: 'POST', token: tenant.idToken, body: { organizationId, planId: 'founding_100' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.idempotent, true);

  response = await callApi(`/api/client/licensing?organizationId=${organizationId}`, { token: tenant.idToken });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.license.status, 'trialing');

  response = await callApi(`/api/client/licensing?organizationId=${organizationId}`, { token: outsider.idToken });
  assert.equal(response.status, 403);

  const superAdmin = await createUser('platform-super-admin');
  const supportAdmin = await createUser('platform-support');
  await Promise.all([
    adminDb.collection('platformAdmins').doc(superAdmin.localId).set({ role: 'SUPER_ADMIN', status: 'ACTIVE', email: superAdmin.email }),
    adminDb.collection('platformAdmins').doc(supportAdmin.localId).set({ role: 'SUPPORT', status: 'ACTIVE', email: supportAdmin.email }),
  ]);

  response = await callApi('/api/subscription-operations');
  assert.equal(response.status, 401);

  response = await callApi('/api/subscription-operations', { token: supportAdmin.idToken });
  assert.equal(response.status, 200);
  assert.ok(response.body.data.overview);
  assert.equal('licenses' in response.body.data, false);
  response = await callApi('/api/subscription-operations/licenses', { token: supportAdmin.idToken });
  assert.equal(response.status, 200);
  assert.ok(response.body.data.licenses.some((license) => license.organizationId === organizationId));

  response = await callApi('/api/subscription-plans/founding_100', {
    method: 'PATCH', token: supportAdmin.idToken, body: { publicSignup: false },
  });
  assert.equal(response.status, 403);

  response = await callApi(`/api/organizations/${organizationId}/license/suspend`, {
    method: 'POST', token: supportAdmin.idToken, body: { reason: 'Support must remain read-only' },
  });
  assert.equal(response.status, 403);

  response = await callApi('/api/subscription-plans/founding_100', {
    method: 'PATCH', token: superAdmin.idToken, body: { publicSignup: false },
  });
  assert.equal(response.status, 200);
  response = await callApi('/api/subscription-plans/standard', {
    method: 'PATCH', token: superAdmin.idToken, body: { publicSignup: true },
  });
  assert.equal(response.status, 200);

  response = await callApi('/api/public/signup-plans');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.map((plan) => plan.planId), ['standard']);

  const now = Date.now();
  const activeOrganizationId = await seedSubscriptionLicense({ label: 'active-renewal', status: 'ACTIVE', planId: 'standard', subscriptionStatus: 'active', subscriptionEndsAt: new Date(now + 3 * 86_400_000) });
  const expiredOrganizationId = await seedSubscriptionLicense({ label: 'expired', status: 'EXPIRED', planId: 'standard', subscriptionStatus: 'expired', subscriptionEndsAt: new Date(now - 86_400_000) });
  const suspendedOrganizationId = await seedSubscriptionLicense({ label: 'suspended', status: 'SUSPENDED', planId: 'standard', subscriptionStatus: 'cancelled', subscriptionEndsAt: new Date(now + 30 * 86_400_000) });

  await adminDb.collection('platformPlanUsage').doc('founding_100').set({ eligibleCustomerCount: 0, marker: 'intentional-read-only-mismatch' });
  response = await callApi('/api/subscription-operations', { token: superAdmin.idToken });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.overview.founding100.matches, false);
  assert.ok(response.body.data.overview.founding100.canonicalEligibleCustomerCount > response.body.data.overview.founding100.storedEligibleCustomerCount);
  assert.deepEqual({
    standard: response.body.data.overview.standardSubscriptionCount,
    trial: response.body.data.overview.trialCount,
    active: response.body.data.overview.activeCount,
    expired: response.body.data.overview.expiredCount,
    suspended: response.body.data.overview.suspendedCount,
  }, { standard: 3, trial: 1, active: 1, expired: 1, suspended: 1 });
  assert.deepEqual(response.body.data.overview.upcomingRenewals.map((license) => license.organizationId), [activeOrganizationId]);
  response = await callApi('/api/subscription-operations/licenses', { token: superAdmin.idToken });
  assert.equal(response.status, 200);
  const operationLicense = response.body.data.licenses.find((license) => license.organizationId === organizationId);
  assert.equal(operationLicense.status, 'TRIAL');
  assert.ok(operationLicense.trialEndsAt);
  assert.ok(operationLicense.allowedActions.includes('SUSPEND'));
  assert.equal(response.body.data.licenses.find((license) => license.organizationId === activeOrganizationId).status, 'ACTIVE');
  assert.equal(response.body.data.licenses.find((license) => license.organizationId === expiredOrganizationId).status, 'EXPIRED');
  assert.equal(response.body.data.licenses.find((license) => license.organizationId === suspendedOrganizationId).status, 'SUSPENDED');

  response = await callApi(`/api/subscription-operations/${organizationId}`, { token: superAdmin.idToken });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.license.organizationId, organizationId);
  assert.equal(response.body.data.plan.planId, 'founding_100');
  assert.ok(response.body.data.auditHistory.some((item) => item.action === 'SUBSCRIPTION_TRIAL_STARTED'));
  assert.doesNotMatch(JSON.stringify(response.body.data), new RegExp(`crm-root-${suffix}|crm-lead-${suffix}`));
});
