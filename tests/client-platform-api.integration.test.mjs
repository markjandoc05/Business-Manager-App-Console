import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';

const PROJECT_ID = 'demo-bsm-console';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!process.env.FIRESTORE_EMULATOR_HOST || !authHost || resolveFirebaseProjectIdentity().mode !== 'emulator' || resolveFirebaseProjectIdentity().projectId !== PROJECT_ID) {
  throw new Error('Refusing Client Platform API integration tests outside the isolated demo Firebase emulators.');
}

const [firebase, planContract, licenseContract, planService, { GET: plansRoute }, { POST: trialsRoute }, { GET: subscriptionRoute }] = await Promise.all([
  import('../lib/server/firebase-admin-core.ts'),
  import('../lib/subscription-plan-contract.ts'),
  import('../lib/license-contract.ts'),
  import('../lib/server/subscription-plan-service.ts'),
  import('../app/api/v1/plans/route.ts'),
  import('../app/api/v1/trials/route.ts'),
  import('../app/api/v1/subscription/route.ts'),
]);

const { adminAuth, adminDb } = firebase;
const { DEFAULT_SUBSCRIPTION_PLANS } = planContract;
const { parseCanonicalLicense } = licenseContract;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let sequence = 0;
const nextId = (prefix) => `${prefix}-${suffix}-${++sequence}`;

async function createUser(label) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${label}-${suffix}@example.test`, password: 'client-platform-api-test-123', returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'Auth signup failed');
  return body;
}

async function seedCatalog({ foundingPublic = true, standardPublic = false, foundingCount = 0, standardCount = 0 } = {}) {
  await Promise.all([
    adminDb.collection('platformPlans').doc('founding_100').set({ ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, publicSignup: foundingPublic }),
    adminDb.collection('platformPlans').doc('standard').set({ ...DEFAULT_SUBSCRIPTION_PLANS.standard, publicSignup: standardPublic }),
    adminDb.collection('platformPlanUsage').doc('founding_100').set({ eligibleCustomerCount: foundingCount }),
    adminDb.collection('platformPlanUsage').doc('standard').set({ eligibleCustomerCount: standardCount }),
  ]);
}

function workspace(label, overrides = {}) {
  const id = nextId(label);
  return {
    productCode: 'founding_100',
    workspace: {
      businessName: `Workspace ${id}`,
      requestedSlug: `workspace-${id}`,
      businessType: 'Agency',
      currency: 'USD',
      timezone: 'Asia/Manila',
      ...overrides,
    },
  };
}

function requestHeaders(token, idempotencyKey, body = true) {
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
  if (body) headers.set('Content-Type', 'application/json');
  return headers;
}

async function read(response) {
  return { status: response.status, body: await response.json(), headers: response.headers };
}

async function callPlans() {
  return read(await plansRoute(new Request('http://localhost/api/v1/plans')));
}

async function callTrial(token, body, key) {
  return read(await trialsRoute(new Request('http://localhost/api/v1/trials', {
    method: 'POST', headers: requestHeaders(token, key), body: JSON.stringify(body),
  })));
}

async function callSubscription(token, workspaceId) {
  return read(await subscriptionRoute(new Request(`http://localhost/api/v1/subscription?workspaceId=${encodeURIComponent(workspaceId)}`, {
    headers: requestHeaders(token, undefined, false),
  })));
}

function assertError(response, status, code) {
  assert.equal(response.status, status);
  assert.deepEqual(Object.keys(response.body).sort(), ['error', 'success']);
  assert.equal(response.body.success, false);
  assert.deepEqual(Object.keys(response.body.error).sort(), ['code', 'message']);
  assert.equal(response.body.error.code, code);
}

async function seedOrganizationLicense({ user, status, plan = 'TEAM', subscriptionEndsAt, trialEndsAt }) {
  const organizationId = nextId('license-org');
  const now = Date.now();
  const ref = adminDb.collection('organizations').doc(organizationId);
  await adminDb.collection('users').doc(user.localId).set({ uid: user.localId, status: 'active', active: true });
  await ref.set({ name: `License workspace ${organizationId}` });
  await ref.collection('members').doc(user.localId).set({ userId: user.localId, role: 'ADMIN', status: 'active' });
  await ref.collection('license').doc('current').set({
    organizationId,
    plan,
    status,
    maxUsers: plan === 'SOLO' ? 1 : 3,
    features: { crm: true },
    ...(status === 'TRIAL'
      ? { trialStartedAt: new Date(now - 60_000), trialEndsAt: trialEndsAt || new Date(now + 86_400_000) }
      : status === 'ACTIVE'
        ? { subscriptionStartedAt: new Date(now - 120_000), subscriptionEndsAt: subscriptionEndsAt || new Date(now + 86_400_000), renewalDate: subscriptionEndsAt || new Date(now + 86_400_000) }
        : {}),
  });
  return { organizationId, ref };
}

test('v1 plan list has a minimal public schema and follows manual signup switching', async () => {
  await seedCatalog();
  let response = await callPlans();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(response.body.data, {
    plans: [{
      code: 'founding_100', name: 'Founding 100', price: 99, currency: 'USD', billingInterval: 'year', trialDays: 14, requiresCard: false, available: true,
      marketing: {
        badge: 'Limited to the first 100 customers',
        messages: [
          'Keep your Founding rate for as long as your subscription remains active.',
          'Standard price after the first 100: $149/year',
        ],
      },
    }],
  });
  assert.equal('maxEligibleCustomers' in response.body.data.plans[0], false);
  assert.equal('entitlementTier' in response.body.data.plans[0], false);
  assert.equal('usage' in response.body.data.plans[0], false);

  const actor = { uid: nextId('platform-admin'), email: 'platform-admin@example.test', role: 'SUPER_ADMIN' };
  await planService.updateSubscriptionPlan('founding_100', { publicSignup: false }, actor);
  await planService.updateSubscriptionPlan('standard', { publicSignup: true }, actor);
  response = await callPlans();
  assert.deepEqual(response.body.data.plans.map((plan) => plan.code), ['standard']);
  assert.equal(response.body.data.plans[0].available, true);
  assert.equal('marketing' in response.body.data.plans[0], false);
});

test('v1 only returns Founding marketing while the trusted capped offer is available', async () => {
  await seedCatalog({ foundingCount: 100, standardPublic: true });
  const plans = await callPlans();
  assert.equal(plans.status, 200);
  assert.deepEqual(plans.body.data.plans.map((plan) => plan.code), ['standard']);
  assert.equal(plans.body.data.plans.some((plan) => plan.code === 'founding_100'), false);
  assert.equal(plans.body.data.plans.some((plan) => 'marketing' in plan), false);

  const user = await createUser('founding-marketing-full');
  assertError(
    await callTrial(user.idToken, workspace('founding-marketing-full'), 'founding-marketing-full-key-0001'),
    409,
    'FOUNDING_LIMIT_REACHED',
  );
});

test('v1 authentication rejects missing, invalid, and revoked Firebase tokens', async () => {
  await seedCatalog();
  const body = workspace('auth');
  assertError(await callTrial('', body, 'auth-missing-token-0001'), 401, 'UNAUTHENTICATED');
  assertError(await callTrial('not-a-firebase-token', body, 'auth-invalid-token-0001'), 401, 'UNAUTHENTICATED');

  const revoked = await createUser('revoked-token');
  // Firebase revocation uses auth_time granularity. Let this signed-in token
  // age past the next second before revoking it, then exercise checkRevoked.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await adminAuth.revokeRefreshTokens(revoked.localId);
  assertError(await callTrial(revoked.idToken, workspace('revoked'), 'auth-revoked-token-0001'), 401, 'UNAUTHENTICATED');
});

test('v1 provisioning derives commercial authority, creates a canonical trial, and safely replays', async () => {
  await seedCatalog();
  const user = await createUser('provision');
  const key = 'provision-replay-key-0001';
  const body = workspace('provision');
  const first = await callTrial(user.idToken, body, key);
  assert.equal(first.status, 201);
  assert.equal(first.body.success, true);
  assert.deepEqual(first.body.data.license, {
    plan: 'TRIAL',
    status: 'TRIAL',
    trialStartedAt: first.body.data.license.trialStartedAt,
    trialEndsAt: first.body.data.license.trialEndsAt,
    subscriptionStartedAt: null,
    renewalDate: null,
    expirationDate: first.body.data.license.trialEndsAt,
    maxUsers: 3,
    billingInterval: 'year',
  });
  assert.equal(first.body.data.productCode, 'founding_100');
  assert.equal(first.body.data.provisioningStatus, 'PROVISIONED');
  assert.equal('entitlementTier' in first.body.data.license, false);
  const organizationId = first.body.data.organizationId;
  const [licenseSnapshot, usageSnapshot] = await Promise.all([
    adminDb.collection('organizations').doc(organizationId).collection('license').doc('current').get(),
    adminDb.collection('platformPlanUsage').doc('founding_100').get(),
  ]);
  const canonical = parseCanonicalLicense(licenseSnapshot.data());
  assert.equal(canonical?.plan, 'TRIAL');
  assert.equal(canonical?.status, 'TRIAL');
  assert.equal(canonical?.entitlementTier, 'STARTER');
  assert.equal(canonical?.maxUsers, 3);
  assert.equal(usageSnapshot.data().eligibleCustomerCount, 1);

  await adminDb.collection('organizations').doc(organizationId).collection('leads').doc('private').set({ marker: `crm-${suffix}` });
  const current = await callSubscription(user.idToken, organizationId);
  assert.equal(current.status, 200);
  assert.equal(current.body.data.license.plan, 'TRIAL');
  assert.doesNotMatch(JSON.stringify(current.body), new RegExp(`crm-${suffix}`));

  const retried = await callTrial(user.idToken, body, key);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.data.idempotent, true);
  assert.equal(retried.body.data.provisioningStatus, 'REUSED');
  assert.equal(retried.body.data.organizationId, organizationId);
  assert.equal((await adminDb.collection('platformPlanUsage').doc('founding_100').get()).data().eligibleCustomerCount, 1);
  assert.equal((await adminDb.collection('platformAuditLogs').where('organizationId', '==', organizationId).get()).size, 1);
  const idempotencyRecords = await adminDb.collection('platformProvisioningIdempotency').get();
  const record = idempotencyRecords.docs.find((item) => item.data().result?.organizationId === organizationId);
  assert.ok(record);
  assert.notEqual(record.id, key);
  assert.doesNotMatch(JSON.stringify(record.data()), new RegExp(key));

  const conflicting = await callTrial(user.idToken, workspace('provision-conflict'), key);
  assertError(conflicting, 409, 'IDEMPOTENCY_CONFLICT');

  const existingTrial = await callTrial(user.idToken, { ...workspace('existing-trial'), productCode: 'standard' }, 'existing-trial-key-0001');
  assertError(existingTrial, 409, 'TRIAL_ALREADY_EXISTS');

  const collisionUser = await createUser('workspace-collision');
  const collisionBody = workspace('workspace-collision');
  collisionBody.workspace.requestedSlug = body.workspace.requestedSlug;
  assertError(await callTrial(collisionUser.idToken, collisionBody, 'workspace-collision-key-0001'), 409, 'WORKSPACE_ALREADY_EXISTS');

  const browserOverrides = [
    { price: 0 },
    { trialDays: 365 },
    { entitlementTier: 'TEAM' },
    { maxUsers: 99 },
    { available: false },
    { publicSignup: false },
    { marketing: { badge: 'Browser-controlled offer', messages: ['Do not trust this.'] } },
  ];
  for (const [index, override] of browserOverrides.entries()) {
    assertError(
      await callTrial(user.idToken, { ...body, ...override }, `provision-unsupported-${index}-0001`),
      400,
      'INVALID_REQUEST',
    );
  }
  assert.equal((await adminDb.collection('platformPlanUsage').doc('founding_100').get()).data().eligibleCustomerCount, 1);
});

test('v1 treats a lost response and concurrent duplicate request as one committed provisioning outcome', async () => {
  await seedCatalog({ standardPublic: true });
  const lostUser = await createUser('lost-response');
  const lostKey = 'lost-response-retry-key-0001';
  const lostBody = { ...workspace('lost-response'), productCode: 'standard' };
  // Deliberately do not read the first body: this models a response lost after
  // the server committed its transaction.
  const lostResponse = await trialsRoute(new Request('http://localhost/api/v1/trials', {
    method: 'POST', headers: requestHeaders(lostUser.idToken, lostKey), body: JSON.stringify(lostBody),
  }));
  assert.equal(lostResponse.status, 201);
  const recovered = await callTrial(lostUser.idToken, lostBody, lostKey);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.data.idempotent, true);

  const concurrentUser = await createUser('concurrent-duplicate');
  const concurrentKey = 'concurrent-duplicate-key-0001';
  const concurrentBody = { ...workspace('concurrent'), productCode: 'standard' };
  const [first, second] = await Promise.all([
    callTrial(concurrentUser.idToken, concurrentBody, concurrentKey),
    callTrial(concurrentUser.idToken, concurrentBody, concurrentKey),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 201]);
  assert.equal(first.body.data.organizationId, second.body.data.organizationId);
  assert.equal([first.body.data.idempotent, second.body.data.idempotent].filter(Boolean).length, 1);
  const standardUsage = await adminDb.collection('platformPlanUsage').doc('standard').get();
  assert.equal(standardUsage.data().eligibleCustomerCount, 2);

  const otherIdentity = await createUser('same-key-other-identity');
  const independent = await callTrial(otherIdentity.idToken, { ...workspace('other-identity'), productCode: 'standard' }, concurrentKey);
  assert.equal(independent.status, 201);
  assert.notEqual(independent.body.data.organizationId, first.body.data.organizationId);
});

test('v1 closes invalid or unavailable products and enforces exactly the Founding 100 cap', async () => {
  await seedCatalog({ foundingCount: 99 });
  const invalidUser = await createUser('invalid-product');
  const invalid = await callTrial(invalidUser.idToken, { ...workspace('invalid-product'), productCode: 'unknown_product' }, 'invalid-product-key-0001');
  assertError(invalid, 400, 'INVALID_PLAN');

  const unavailable = await callTrial(invalidUser.idToken, { ...workspace('unavailable'), productCode: 'standard' }, 'unavailable-product-key-0001');
  assertError(unavailable, 409, 'PLAN_UNAVAILABLE');

  const [firstUser, secondUser] = await Promise.all([createUser('founding-final-first'), createUser('founding-final-second')]);
  const [first, second] = await Promise.all([
    callTrial(firstUser.idToken, workspace('founding-final-first'), 'founding-final-first-key-0001'),
    callTrial(secondUser.idToken, workspace('founding-final-second'), 'founding-final-second-key-0001'),
  ]);
  const responses = [first, second];
  assert.equal(responses.filter((response) => response.status === 201).length, 1);
  assert.equal(responses.filter((response) => response.status === 409 && response.body.error?.code === 'FOUNDING_LIMIT_REACHED').length, 1);
  assert.equal((await adminDb.collection('platformPlanUsage').doc('founding_100').get()).data().eligibleCustomerCount, 100);
});

test('v1 status read enforces tenant membership, preserves V1, and projects expired and suspended states', async () => {
  await seedCatalog();
  const legacyUser = await createUser('legacy');
  const now = Date.now();
  const legacy = await seedOrganizationLicense({ user: legacyUser, status: 'TRIAL', plan: 'TRIAL', trialEndsAt: new Date(now + 86_400_000) });
  const legacyResponse = await callTrial(legacyUser.idToken, workspace('legacy'), 'legacy-reconcile-key-0001');
  assert.equal(legacyResponse.status, 200);
  assert.equal(legacyResponse.body.data.provisioningStatus, 'LEGACY_RECONCILED');
  assert.equal(legacyResponse.body.data.legacy, true);
  assert.equal(legacyResponse.body.data.productCode, null);
  assert.equal(legacyResponse.body.data.organizationId, legacy.organizationId);
  assert.equal((await adminDb.collection('platformPlanUsage').doc('founding_100').get()).data().eligibleCustomerCount, 0);

  const legacyStatus = await callSubscription(legacyUser.idToken, legacy.organizationId);
  assert.equal(legacyStatus.status, 200);
  assert.equal(legacyStatus.body.data.legacy, true);
  assert.equal(legacyStatus.body.data.license.plan, 'TRIAL');

  const outsider = await createUser('cross-tenant');
  assertError(await callSubscription(outsider.idToken, legacy.organizationId), 403, 'FORBIDDEN');

  const missing = nextId('missing-license');
  await adminDb.collection('organizations').doc(missing).set({ name: 'Missing license workspace' });
  await adminDb.collection('organizations').doc(missing).collection('members').doc(legacyUser.localId).set({ userId: legacyUser.localId, role: 'ADMIN', status: 'active' });
  assertError(await callSubscription(legacyUser.idToken, missing), 404, 'LICENSE_NOT_FOUND');

  const expired = await seedOrganizationLicense({ user: legacyUser, status: 'ACTIVE', subscriptionEndsAt: new Date(now - 60_000) });
  const suspended = await seedOrganizationLicense({ user: legacyUser, status: 'SUSPENDED', plan: 'STARTER' });
  const [expiredResponse, suspendedResponse] = await Promise.all([
    callSubscription(legacyUser.idToken, expired.organizationId),
    callSubscription(legacyUser.idToken, suspended.organizationId),
  ]);
  assert.equal(expiredResponse.status, 200, JSON.stringify(expiredResponse.body));
  assert.equal(suspendedResponse.status, 200, JSON.stringify(suspendedResponse.body));
  assert.equal(expiredResponse.body.data.license.status, 'EXPIRED');
  assert.equal(suspendedResponse.body.data.license.status, 'SUSPENDED');
});
