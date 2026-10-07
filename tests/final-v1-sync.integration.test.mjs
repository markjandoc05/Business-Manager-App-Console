import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';

const PROJECT_ID = 'demo-bsm-console';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const baseUrl = process.env.VENTALE_CONSOLE_BASE_URL || 'http://127.0.0.1:3002';
if (!process.env.FIRESTORE_EMULATOR_HOST || !authHost || resolveFirebaseProjectIdentity().mode !== 'emulator' || resolveFirebaseProjectIdentity().projectId !== PROJECT_ID) {
  throw new Error('Refusing final V1 synchronization integration tests outside the isolated demo Firebase emulators.');
}

const [{ adminDb }, { DEFAULT_SUBSCRIPTION_PLANS }, { parseCanonicalLicense }] = await Promise.all([
  import('../lib/server/firebase-admin-core.ts'),
  import('../lib/subscription-plan-contract.ts'),
  import('../lib/license-contract.ts'),
]);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function createUser(label) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${label}-${suffix}@example.test`, password: 'final-v1-sync-test-password', returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'Auth signup failed');
  return body;
}

async function request(path, { method = 'GET', token, body, idempotencyKey } = {}) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (idempotencyKey) headers.set('idempotency-key', idempotencyKey);
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function workspace(productCode, label) {
  return {
    productCode,
    workspace: {
      businessName: `${label} ${suffix}`,
      requestedSlug: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}`,
      businessType: 'Agency',
      currency: 'USD',
      timezone: 'Asia/Manila',
    },
  };
}

function assertTrial(canonical, productCode, price) {
  assert.equal(canonical?.planId, productCode);
  assert.equal(canonical?.status, 'TRIAL');
  assert.equal(canonical?.plan, 'TRIAL');
  assert.equal(canonical?.entitlementTier, 'STARTER');
  assert.equal(canonical?.maxUsers, 3);
  assert.equal(canonical?.priceAtSubscription, price);
  assert.equal(canonical?.currency, 'USD');
  assert.equal(canonical?.billingInterval, 'year');
  assert.ok(canonical?.trialStartedAt);
  assert.ok(canonical?.trialEndsAt);
}

test('final V1 commercial lifecycle stays synchronized across Client API, canonical state, Console, Health, and Audit', async () => {
  await Promise.all([
    adminDb.collection('platformPlans').doc('founding_100').set(DEFAULT_SUBSCRIPTION_PLANS.founding_100),
    adminDb.collection('platformPlans').doc('standard').set(DEFAULT_SUBSCRIPTION_PLANS.standard),
    adminDb.collection('platformPlanUsage').doc('founding_100').set({ eligibleCustomerCount: 0 }),
    adminDb.collection('platformPlanUsage').doc('standard').set({ eligibleCustomerCount: 0 }),
  ]);

  let plans = await request('/api/v1/plans');
  assert.equal(plans.status, 200);
  assert.deepEqual(plans.body.data.plans.map((plan) => plan.code), ['founding_100']);
  assert.equal('entitlementTier' in plans.body.data.plans[0], false);
  assert.equal('maxEligibleCustomers' in plans.body.data.plans[0], false);

  const foundingUser = await createUser('final-founding-owner');
  const foundingPayload = workspace('founding_100', 'Founding Workspace');
  const foundingKey = `founding-${suffix}-idempotency-key`;
  const foundingTrial = await request('/api/v1/trials', {
    method: 'POST', token: foundingUser.idToken, body: foundingPayload, idempotencyKey: foundingKey,
  });
  assert.equal(foundingTrial.status, 201, JSON.stringify(foundingTrial.body));
  assert.equal(foundingTrial.body.data.productCode, 'founding_100');
  assert.equal(foundingTrial.body.data.license.plan, 'TRIAL');
  assert.equal(foundingTrial.body.data.license.status, 'TRIAL');
  assert.equal(foundingTrial.body.data.license.maxUsers, 3);
  const foundingOrganizationId = foundingTrial.body.data.organizationId;
  const foundingOrganizationRef = adminDb.collection('organizations').doc(foundingOrganizationId);
  const [foundingOrganization, foundingLicense, foundingUsage] = await Promise.all([
    foundingOrganizationRef.get(),
    foundingOrganizationRef.collection('license').doc('current').get(),
    adminDb.collection('platformPlanUsage').doc('founding_100').get(),
  ]);
  const foundingCanonical = parseCanonicalLicense(foundingLicense.data());
  assertTrial(foundingCanonical, 'founding_100', 99);
  assert.equal(foundingOrganization.data()?.licenseStatus, 'TRIAL');
  assert.equal(foundingOrganization.data()?.licenseWriteEnabled, true);
  assert.equal(foundingOrganization.data()?.maxUsers, 3);
  assert.equal(foundingUsage.data()?.eligibleCustomerCount, 1);

  await foundingOrganizationRef.collection('leads').doc('private').set({ marker: `crm-private-${suffix}` });
  const foundingReplay = await request('/api/v1/trials', {
    method: 'POST', token: foundingUser.idToken, body: foundingPayload, idempotencyKey: foundingKey,
  });
  assert.equal(foundingReplay.status, 200);
  assert.equal(foundingReplay.body.data.idempotent, true);
  assert.equal(foundingReplay.body.data.organizationId, foundingOrganizationId);
  assert.equal((await adminDb.collection('platformPlanUsage').doc('founding_100').get()).data()?.eligibleCustomerCount, 1);
  assert.equal((await adminDb.collection('platformAuditLogs').where('organizationId', '==', foundingOrganizationId).get()).size, 1);

  let clientLicense = await request(`/api/v1/subscription?workspaceId=${encodeURIComponent(foundingOrganizationId)}`, { token: foundingUser.idToken });
  assert.equal(clientLicense.status, 200);
  assert.equal(clientLicense.body.data.license.plan, 'TRIAL');
  assert.equal(clientLicense.body.data.license.status, 'TRIAL');
  assert.doesNotMatch(JSON.stringify(clientLicense.body), new RegExp(`crm-private-${suffix}`));

  const superAdmin = await createUser('final-super-admin');
  const support = await createUser('final-support');
  await Promise.all([
    adminDb.collection('platformAdmins').doc(superAdmin.localId).set({ role: 'SUPER_ADMIN', status: 'ACTIVE', email: superAdmin.email }),
    adminDb.collection('platformAdmins').doc(support.localId).set({ role: 'SUPPORT', status: 'ACTIVE', email: support.email }),
  ]);
  const startedAt = new Date().toISOString();
  const renewalAt = new Date(Date.now() + 365 * 86_400_000).toISOString();
  const activation = await request(`/api/organizations/${foundingOrganizationId}/license/convert-to-paid`, {
    method: 'POST', token: superAdmin.idToken,
    // These legacy Console fields are deliberately ignored for commercial products.
    body: { plan: 'TEAM', maxUsers: 99, subscriptionStartedAt: startedAt, subscriptionEndsAt: renewalAt },
  });
  assert.equal(activation.status, 200, JSON.stringify(activation.body));
  assert.equal(activation.body.data.license.status, 'ACTIVE');
  assert.equal(activation.body.data.license.plan, 'STARTER');
  assert.equal(activation.body.data.license.maxUsers, 3);
  const paidFounding = parseCanonicalLicense((await foundingOrganizationRef.collection('license').doc('current').get()).data());
  assert.equal(paidFounding?.planId, 'founding_100');
  assert.equal(paidFounding?.status, 'ACTIVE');
  assert.equal(paidFounding?.plan, 'STARTER');
  assert.equal(paidFounding?.entitlementTier, 'STARTER');
  assert.equal(paidFounding?.priceAtSubscription, 99);
  assert.equal(paidFounding?.billingInterval, 'year');
  assert.ok(paidFounding?.renewalDate);

  clientLicense = await request(`/api/v1/subscription?workspaceId=${encodeURIComponent(foundingOrganizationId)}`, { token: foundingUser.idToken });
  assert.equal(clientLicense.status, 200);
  assert.equal(clientLicense.body.data.productCode, 'founding_100');
  assert.equal(clientLicense.body.data.license.status, 'ACTIVE');
  assert.equal(clientLicense.body.data.license.plan, 'STARTER');
  assert.equal(clientLicense.body.data.license.maxUsers, 3);

  let operations = await request('/api/subscription-operations/licenses', { token: superAdmin.idToken });
  assert.equal(operations.status, 200);
  const foundingConsoleLicense = operations.body.data.licenses.find((license) => license.organizationId === foundingOrganizationId);
  assert.equal(foundingConsoleLicense.planId, 'founding_100');
  assert.equal(foundingConsoleLicense.canonicalPlan, 'STARTER');
  assert.equal(foundingConsoleLicense.entitlementTier, 'STARTER');
  assert.equal(foundingConsoleLicense.status, 'ACTIVE');
  assert.equal(foundingConsoleLicense.priceAtSubscription, 99);
  assert.equal(foundingConsoleLicense.maxUsers, 3);
  const licenseDetail = await request(`/api/subscription-operations/${foundingOrganizationId}`, { token: superAdmin.idToken });
  assert.equal(licenseDetail.status, 200);
  assert.ok(licenseDetail.body.data.auditHistory.some((event) => event.action === 'SUBSCRIPTION_TRIAL_STARTED'));
  assert.ok(licenseDetail.body.data.auditHistory.some((event) => event.action === 'ORGANIZATION_TRIAL_CONVERTED_TO_PAID'));

  assert.equal((await request('/api/subscription-operations/licenses', { token: support.idToken })).status, 200);
  assert.equal((await request(`/api/organizations/${foundingOrganizationId}/license/suspend`, { method: 'POST', token: support.idToken, body: { reason: 'must fail' } })).status, 403);
  assert.equal((await request('/api/subscription-operations/licenses', { token: foundingUser.idToken })).status, 403);

  assert.equal((await request('/api/subscription-plans/founding_100', { method: 'PATCH', token: superAdmin.idToken, body: { publicSignup: false } })).status, 200);
  assert.equal((await request('/api/subscription-plans/standard', { method: 'PATCH', token: superAdmin.idToken, body: { publicSignup: true } })).status, 200);
  plans = await request('/api/v1/plans');
  assert.equal(plans.status, 200);
  assert.deepEqual(plans.body.data.plans.map((plan) => plan.code), ['standard']);

  const standardUser = await createUser('final-standard-owner');
  const standardPayload = workspace('standard', 'Standard Workspace');
  const standardTrial = await request('/api/v1/trials', {
    method: 'POST', token: standardUser.idToken, body: standardPayload, idempotencyKey: `standard-${suffix}-idempotency-key`,
  });
  assert.equal(standardTrial.status, 201, JSON.stringify(standardTrial.body));
  const standardOrganizationId = standardTrial.body.data.organizationId;
  const standardRef = adminDb.collection('organizations').doc(standardOrganizationId);
  assertTrial(parseCanonicalLicense((await standardRef.collection('license').doc('current').get()).data()), 'standard', 149);
  assert.equal((await adminDb.collection('platformPlanUsage').doc('founding_100').get()).data()?.eligibleCustomerCount, 1);

  const standardActivation = await request(`/api/organizations/${standardOrganizationId}/license/convert-to-paid`, {
    method: 'POST', token: superAdmin.idToken,
    body: { plan: 'TEAM', maxUsers: 99, subscriptionStartedAt: startedAt, subscriptionEndsAt: renewalAt },
  });
  assert.equal(standardActivation.status, 200, JSON.stringify(standardActivation.body));
  const paidStandard = parseCanonicalLicense((await standardRef.collection('license').doc('current').get()).data());
  assert.equal(paidStandard?.status, 'ACTIVE');
  assert.equal(paidStandard?.plan, 'STARTER');
  assert.equal(paidStandard?.entitlementTier, 'STARTER');

  const health = await request('/api/platform-health', { token: support.idToken });
  assert.equal(health.status, 200);
  assert.equal(health.body.data.status, 'HEALTHY');
  assert.equal(health.body.data.warnings.some((warning) => warning.code === 'FOUNDING_100_USAGE_MISMATCH'), false);
  assert.equal(health.body.data.warnings.some((warning) => warning.code === 'ORGANIZATION_LICENSE_MIRROR_INCONSISTENT'), false);

  const audit = await request(`/api/audit-logs?organizationId=${encodeURIComponent(foundingOrganizationId)}`, { token: superAdmin.idToken });
  assert.equal(audit.status, 200);
  assert.ok(audit.body.data.items.some((event) => event.action === 'SUBSCRIPTION_TRIAL_STARTED'));
  assert.ok(audit.body.data.items.some((event) => event.action === 'ORGANIZATION_TRIAL_CONVERTED_TO_PAID'));
  assert.doesNotMatch(JSON.stringify(audit.body), /@example\.test|crm-private|previousValue|newValue|private/);
});
