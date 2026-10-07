import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';

const PROJECT_ID = 'demo-bsm-console';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!process.env.FIRESTORE_EMULATOR_HOST || !authHost || resolveFirebaseProjectIdentity().mode !== 'emulator' || resolveFirebaseProjectIdentity().projectId !== PROJECT_ID) {
  throw new Error('Refusing plan-marketing integration tests outside the isolated demo Firebase emulators.');
}

const [{ adminDb }, { DEFAULT_SUBSCRIPTION_PLANS }, { PATCH: updateMarketingRoute, DELETE: clearMarketingRoute }, { GET: publicPlansRoute }] = await Promise.all([
  import('../lib/server/firebase-admin-core.ts'),
  import('../lib/subscription-plan-contract.ts'),
  import('../app/api/subscription-plans/[planId]/marketing/route.ts'),
  import('../app/api/v1/plans/route.ts'),
]);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function createUser(label) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${label}-${suffix}@example.test`, password: 'plan-marketing-test-password', returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'Auth signup failed');
  return body;
}

async function seedCatalog({ foundingPublic = true, standardPublic = false, foundingCount = 0 } = {}) {
  await Promise.all([
    adminDb.collection('platformPlans').doc('founding_100').set({ ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, publicSignup: foundingPublic }),
    adminDb.collection('platformPlans').doc('standard').set({ ...DEFAULT_SUBSCRIPTION_PLANS.standard, publicSignup: standardPublic }),
    adminDb.collection('platformPlanUsage').doc('founding_100').set({ eligibleCustomerCount: foundingCount }),
    adminDb.collection('platformPlanUsage').doc('standard').set({ eligibleCustomerCount: 0 }),
  ]);
}

async function read(response) {
  return { status: response.status, body: await response.json() };
}

async function callMarketing(method, token, planId, body = {}) {
  const request = new Request(`http://localhost/api/subscription-plans/${planId}/marketing`, {
    method,
    headers: { Authorization: token ? `Bearer ${token}` : '', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const handler = method === 'PATCH' ? updateMarketingRoute : clearMarketingRoute;
  return read(await handler(request, { params: Promise.resolve({ planId }) }));
}

async function callPublicPlans() {
  return read(await publicPlansRoute(new Request('http://localhost/api/v1/plans')));
}

function assertError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, code);
}

function immutablePlanConfiguration(data) {
  return {
    planId: data.planId,
    code: data.code,
    entitlementTier: data.entitlementTier,
    displayName: data.displayName,
    price: data.price,
    currency: data.currency,
    billingInterval: data.billingInterval,
    trialDays: data.trialDays,
    noCreditCardRequired: data.noCreditCardRequired,
    foundingLimit: data.foundingLimit,
    maxEligibleCustomers: data.maxEligibleCustomers,
    publicSignup: data.publicSignup,
    autoRolloverEnabled: data.autoRolloverEnabled,
    autoRolloverPlanId: data.autoRolloverPlanId,
  };
}

test('SUPER_ADMIN can update and clear display-only plan marketing without changing commercial authority', async () => {
  await seedCatalog();
  const superAdmin = await createUser('marketing-super-admin');
  await adminDb.collection('platformAdmins').doc(superAdmin.localId).set({ role: 'SUPER_ADMIN', status: 'ACTIVE', email: superAdmin.email });
  const planRef = adminDb.collection('platformPlans').doc('founding_100');
  const before = (await planRef.get()).data();

  const initialPublic = await callPublicPlans();
  assert.equal(initialPublic.status, 200);
  assert.deepEqual(initialPublic.body.data.plans[0].marketing, DEFAULT_SUBSCRIPTION_PLANS.founding_100.marketing);

  const firstMarketing = { badge: 'Early access', messages: ['Keep this Platform-configured rate while your subscription remains active.'] };
  let response = await callMarketing('PATCH', superAdmin.idToken, 'founding_100', { marketing: firstMarketing, expectedRevision: 0 });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.marketingRevision, 1);
  assert.deepEqual(response.body.data.marketing, firstMarketing);

  let saved = (await planRef.get()).data();
  assert.deepEqual(immutablePlanConfiguration(saved), immutablePlanConfiguration(before));
  assert.deepEqual(saved.marketing, firstMarketing);
  assert.equal(saved.marketingRevision, 1);
  assert.equal(saved.marketingUpdatedByUid, superAdmin.localId);
  assert.ok(saved.marketingUpdatedAt);

  let publicPlans = await callPublicPlans();
  const publicFounding = publicPlans.body.data.plans.find((plan) => plan.code === 'founding_100');
  assert.deepEqual(publicFounding.marketing, firstMarketing);
  assert.equal('marketingRevision' in publicFounding, false);
  assert.equal('marketingUpdatedAt' in publicFounding, false);
  assert.equal('marketingUpdatedByUid' in publicFounding, false);
  assert.equal('entitlementTier' in publicFounding, false);
  assert.equal('maxEligibleCustomers' in publicFounding, false);

  assertError(await callMarketing('PATCH', superAdmin.idToken, 'founding_100', { marketing: firstMarketing, expectedRevision: 0 }), 409, 'CONFLICT');
  const secondMarketing = { messages: ['New Platform-authored message.', 'The Client only displays data returned by the Platform.'] };
  response = await callMarketing('PATCH', superAdmin.idToken, 'founding_100', { marketing: secondMarketing, expectedRevision: 1 });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.marketingRevision, 2);
  publicPlans = await callPublicPlans();
  assert.deepEqual(publicPlans.body.data.plans[0].marketing, secondMarketing);

  response = await callMarketing('DELETE', superAdmin.idToken, 'founding_100', { expectedRevision: 2 });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.marketing, null);
  saved = (await planRef.get()).data();
  assert.equal(saved.marketing, null);
  assert.equal(saved.marketingRevision, 3);
  publicPlans = await callPublicPlans();
  assert.equal('marketing' in publicPlans.body.data.plans[0], false);

  const audits = await adminDb.collection('platformAuditLogs').where('targetId', '==', 'founding_100').get();
  assert.ok(audits.docs.some((item) => item.data().action === 'SUBSCRIPTION_PLAN_MARKETING_UPDATED'));
  assert.ok(audits.docs.some((item) => item.data().action === 'SUBSCRIPTION_PLAN_MARKETING_CLEARED'));
  for (const audit of audits.docs.filter((item) => item.data().action.startsWith('SUBSCRIPTION_PLAN_MARKETING_'))) {
    assert.equal(JSON.stringify(audit.data()).includes(firstMarketing.badge), false);
    assert.equal(JSON.stringify(audit.data()).includes(secondMarketing.messages[0]), false);
  }
});

test('marketing editor mutations are SUPER_ADMIN-only and reject browser authority injection', async () => {
  await seedCatalog();
  const [superAdmin, support, tenantAdmin, manager, standardUser] = await Promise.all([
    createUser('marketing-super'), createUser('marketing-support'), createUser('marketing-tenant-admin'), createUser('marketing-manager'), createUser('marketing-user'),
  ]);
  await Promise.all([
    adminDb.collection('platformAdmins').doc(superAdmin.localId).set({ role: 'SUPER_ADMIN', status: 'ACTIVE', email: superAdmin.email }),
    adminDb.collection('platformAdmins').doc(support.localId).set({ role: 'SUPPORT', status: 'ACTIVE', email: support.email }),
  ]);
  const payload = { marketing: { messages: ['Safe marketing copy.'] }, expectedRevision: 0 };
  for (const token of ['', support.idToken, tenantAdmin.idToken, manager.idToken, standardUser.idToken]) {
    const response = await callMarketing('PATCH', token, 'founding_100', payload);
    assert.ok([401, 403].includes(response.status));
  }
  assertError(await callMarketing('PATCH', superAdmin.idToken, 'founding_100', { ...payload, uid: tenantAdmin.localId, role: 'SUPER_ADMIN' }), 400, 'INVALID_REQUEST');
  const plan = (await adminDb.collection('platformPlans').doc('founding_100').get()).data();
  assert.equal(plan.marketingRevision, 0);
  assert.deepEqual(plan.marketing, DEFAULT_SUBSCRIPTION_PLANS.founding_100.marketing);
});

test('marketing validation and narrow mutation schema reject rich content and commercial changes', async () => {
  await seedCatalog();
  const superAdmin = await createUser('marketing-validation-super');
  await adminDb.collection('platformAdmins').doc(superAdmin.localId).set({ role: 'SUPER_ADMIN', status: 'ACTIVE', email: superAdmin.email });
  const planRef = adminDb.collection('platformPlans').doc('founding_100');
  const before = (await planRef.get()).data();
  const invalidPayloads = [
    { marketing: { badge: '<strong>Not plain text</strong>', messages: ['Safe'] }, expectedRevision: 0 },
    { marketing: { messages: [''] }, expectedRevision: 0 },
    { marketing: { messages: ['one', 'two', 'three', 'four'] }, expectedRevision: 0 },
    { marketing: { messages: ['Safe'], price: 0 }, expectedRevision: 0 },
    { marketing: { messages: ['Safe'] }, price: 0, publicSignup: false, trialDays: 365, entitlementTier: 'TEAM', maxEligibleCustomers: 999, expectedRevision: 0 },
  ];
  for (const body of invalidPayloads) assertError(await callMarketing('PATCH', superAdmin.idToken, 'founding_100', body), 400, 'INVALID_REQUEST');
  const after = (await planRef.get()).data();
  assert.deepEqual(immutablePlanConfiguration(after), immutablePlanConfiguration(before));
  assert.deepEqual(after.marketing, before.marketing);
  assert.equal(after.marketingRevision, 0);
});

test('public plans never inherit or expose unavailable marketing', async () => {
  await seedCatalog({ foundingPublic: false, standardPublic: true });
  let publicPlans = await callPublicPlans();
  assert.deepEqual(publicPlans.body.data.plans.map((plan) => plan.code), ['standard']);
  assert.equal('marketing' in publicPlans.body.data.plans[0], false);

  await seedCatalog({ foundingPublic: true, standardPublic: false, foundingCount: 100 });
  publicPlans = await callPublicPlans();
  assert.deepEqual(publicPlans.body.data.plans, []);
});
