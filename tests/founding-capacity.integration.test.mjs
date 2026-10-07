import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';

const projectId = 'demo-bsm-console';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!process.env.FIRESTORE_EMULATOR_HOST || !authHost || resolveFirebaseProjectIdentity().mode !== 'emulator' || resolveFirebaseProjectIdentity().projectId !== projectId) {
  throw new Error('Refusing Founding capacity integration tests outside the isolated demo Firebase emulators.');
}

const [
  { adminDb },
  { DEFAULT_SUBSCRIPTION_PLANS, defaultSubscriptionPlan },
  { PATCH: capacityRoute },
  { GET: publicPlansRoute },
  { GET: platformHealthRoute },
  { bootstrapDefaultSubscriptionPlans, compareFounding100Usage, getSubscriptionPlan, listPublicSignupPlans, updateSubscriptionPlan },
  { startSubscriptionTrial },
  { requireActiveOrganizationMemberToken },
] = await Promise.all([
  import('../lib/server/firebase-admin-core.ts'),
  import('../lib/subscription-plan-contract.ts'),
  import('../app/api/subscription-plans/[planId]/capacity/route.ts'),
  import('../app/api/v1/plans/route.ts'),
  import('../app/api/platform-health/route.ts'),
  import('../lib/server/subscription-plan-service.ts'),
  import('../lib/server/subscription-license-service.ts'),
  import('../lib/server/client-organization-auth.ts'),
]);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const now = () => Date.now();

async function createUser(label) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${label}-${suffix}@example.test`, password: 'founding-capacity-test-password', returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'Auth signup failed');
  await adminDb.collection('users').doc(body.localId).set({uid:body.localId,status:'active',active:true});
  return body;
}

async function seedCatalog({ limit = 100, foundingPublic = true, standardPublic = false, usage = 0 } = {}) {
  await Promise.all([
    adminDb.collection('platformPlans').doc('founding_100').set({ ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, foundingLimit: limit, maxEligibleCustomers: limit, publicSignup: foundingPublic }),
    adminDb.collection('platformPlans').doc('standard').set({ ...DEFAULT_SUBSCRIPTION_PLANS.standard, publicSignup: standardPublic }),
    adminDb.collection('platformPlanUsage').doc('founding_100').set({ eligibleCustomerCount: usage }),
    adminDb.collection('platformPlanUsage').doc('standard').set({ eligibleCustomerCount: 0 }),
  ]);
}

async function seedEligibleFoundingLicenses(start, count, label = 'seed') {
  const batch = adminDb.batch();
  const timestamp = now();
  for (let index = start; index < start + count; index += 1) {
    const organizationId = `founding-capacity-${label}-${suffix}-${index}`;
    batch.set(adminDb.collection('organizations').doc(organizationId).collection('license').doc('current'), {
      organizationId,
      planId: 'founding_100',
      entitlementTier: 'STARTER',
      plan: 'TRIAL',
      status: 'TRIAL',
      subscriptionStatus: 'trialing',
      maxUsers: 3,
      features: {},
      trialStartedAt: new Date(timestamp - 60_000),
      trialEndsAt: new Date(timestamp + 86_400_000),
      subscriptionStartedAt: null,
      subscriptionEndsAt: null,
      renewalDate: null,
      priceAtSubscription: 99,
      currency: 'USD',
      billingInterval: 'year',
    });
  }
  await batch.commit();
}

async function seedOrganizationAdmin(label) {
  const user = await createUser(label);
  const organizationId = `founding-capacity-org-${label}-${suffix}`;
  const organizationRef = adminDb.collection('organizations').doc(organizationId);
  await organizationRef.set({ name: `Founding Capacity ${label}` });
  await organizationRef.collection('members').doc(user.localId).set({ userId: user.localId, role: 'ADMIN', status: 'active' });
  return { user, organizationId };
}

async function read(response) {
  return { status: response.status, body: await response.json() };
}

async function callCapacity(token, body, planId = 'founding_100') {
  const request = new Request(`http://localhost/api/subscription-plans/${planId}/capacity`, {
    method: 'PATCH',
    headers: { Authorization: token ? `Bearer ${token}` : '', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return read(await capacityRoute(request, { params: Promise.resolve({ planId }) }));
}

async function publicPlans() {
  return read(await publicPlansRoute());
}

test('Founding capacity defaults safely, is SUPER_ADMIN-only, and remains transactionally enforced', async () => {
  const [superAdmin, support, organizationAdmin] = await Promise.all([
    createUser('capacity-super-admin'),
    createUser('capacity-support'),
    createUser('capacity-organization-admin'),
  ]);
  await Promise.all([
    adminDb.collection('platformAdmins').doc(superAdmin.localId).set({ role: 'SUPER_ADMIN', status: 'ACTIVE', email: superAdmin.email }),
    adminDb.collection('platformAdmins').doc(support.localId).set({ role: 'SUPPORT', status: 'ACTIVE', email: support.email }),
  ]);

  // Existing catalog documents without the new field still resolve to the
  // historical capacity without a read causing a write.
  const legacyFoundingPlan = { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100 };
  delete legacyFoundingPlan.foundingLimit;
  await Promise.all([
    adminDb.collection('platformPlans').doc('founding_100').set(legacyFoundingPlan),
    adminDb.collection('platformPlans').doc('standard').set(DEFAULT_SUBSCRIPTION_PLANS.standard),
  ]);
  assert.equal((await getSubscriptionPlan('founding_100'))?.foundingLimit, 100);
  assert.equal(defaultSubscriptionPlan('founding_100')?.foundingLimit, 100);
  const bootstrap = await bootstrapDefaultSubscriptionPlans({ uid: superAdmin.localId, email: superAdmin.email, role: 'SUPER_ADMIN' });
  assert.deepEqual(bootstrap.backfilledFoundingLimitPlanIds, ['founding_100']);
  assert.equal((await adminDb.collection('platformPlans').doc('founding_100').get()).data()?.foundingLimit, 100);

  await seedCatalog();
  assert.equal((await callCapacity('', { foundingLimit: 150 })).status, 401);
  assert.equal((await callCapacity(support.idToken, { foundingLimit: 150 })).status, 403);
  assert.equal((await callCapacity(organizationAdmin.idToken, { foundingLimit: 150 })).status, 403);
  assert.equal((await callCapacity(superAdmin.idToken, { foundingLimit: 150, price: 0 })).body.error.code, 'INVALID_REQUEST');
  assert.equal((await callCapacity(superAdmin.idToken, { foundingLimit: 1.5 })).body.error.code, 'INVALID_REQUEST');
  assert.equal((await callCapacity(superAdmin.idToken, { foundingLimit: 100_001 })).body.error.code, 'INVALID_REQUEST');
  assert.equal((await callCapacity(superAdmin.idToken, { foundingLimit: 150 }, 'standard')).status, 404);

  await seedEligibleFoundingLicenses(0, 87, 'baseline');
  const originalLicense = await adminDb.collection('organizations').doc(`founding-capacity-baseline-${suffix}-0`).collection('license').doc('current').get();
  const beforeLicense = originalLicense.data();
  const belowUsage = await callCapacity(superAdmin.idToken, { foundingLimit: 80 });
  assert.equal(belowUsage.status, 409);
  assert.equal(belowUsage.body.error.code, 'FOUNDING_LIMIT_BELOW_USAGE');
  const atUsage = await callCapacity(superAdmin.idToken, { foundingLimit: 87 });
  assert.equal(atUsage.status, 200);
  assert.equal(atUsage.body.data.plan.foundingLimit, 87);
  assert.equal(atUsage.body.data.plan.maxEligibleCustomers, 87);
  assert.equal((await listPublicSignupPlans()).some((plan) => plan.planId === 'founding_100'), false);

  const limitOneHundred = await callCapacity(superAdmin.idToken, { foundingLimit: 100 });
  assert.equal(limitOneHundred.status, 200);
  await seedEligibleFoundingLicenses(87, 13, 'fill');
  const fullBeforeIncrease = await publicPlans();
  assert.equal(fullBeforeIncrease.status, 200);
  assert.equal(fullBeforeIncrease.body.data.plans.some((plan) => plan.code === 'founding_100'), false);
  assert.equal((await adminDb.collection('platformPlans').doc('founding_100').get()).data()?.publicSignup, true);

  const blocked = await seedOrganizationAdmin('blocked-at-one-hundred');
  const blockedActor = await requireActiveOrganizationMemberToken(blocked.user.idToken, blocked.organizationId, ['ADMIN']);
  await assert.rejects(
    () => startSubscriptionTrial(blocked.organizationId, 'founding_100', blockedActor),
    (error) => error?.status === 409,
  );

  const increased = await callCapacity(superAdmin.idToken, { foundingLimit: 150 });
  assert.equal(increased.status, 200);
  assert.equal(increased.body.data.changed, true);
  assert.equal(increased.body.data.plan.foundingLimit, 150);
  assert.equal(increased.body.data.usage.limit, 150);
  assert.equal((await adminDb.collection('organizations').doc(`founding-capacity-baseline-${suffix}-0`).collection('license').doc('current').get()).data()?.priceAtSubscription, beforeLicense?.priceAtSubscription);
  assert.equal((await adminDb.collection('organizations').doc(`founding-capacity-baseline-${suffix}-0`).collection('license').doc('current').get()).data()?.planId, beforeLicense?.planId);

  const availableAfterIncrease = await publicPlans();
  const foundingPublicPlan = availableAfterIncrease.body.data.plans.find((plan) => plan.code === 'founding_100');
  assert.ok(foundingPublicPlan);
  assert.equal('foundingLimit' in foundingPublicPlan, false);
  assert.equal('maxEligibleCustomers' in foundingPublicPlan, false);

  const admittedAfterIncrease = await startSubscriptionTrial(blocked.organizationId, 'founding_100', blockedActor);
  assert.equal(admittedAfterIncrease.license.planId, 'founding_100');
  assert.equal(admittedAfterIncrease.license.priceAtSubscription, 99);

  const health = await read(await platformHealthRoute(new Request('http://localhost/api/platform-health', { headers: { Authorization: `Bearer ${support.idToken}` } })));
  assert.equal(health.status, 200, JSON.stringify(health.body));
  assert.equal(health.body.data.foundingCapacity.configuredLimit, 150);
  assert.equal(health.body.data.foundingCapacity.canonicalEligibleCustomerCount, 101);
  assert.equal(health.body.data.foundingCapacity.remainingCapacity, 49);

  // Build the exact 149/150 case from canonical licenses, then race two
  // independent tenant-admin requests. The transaction permits one final slot.
  await seedEligibleFoundingLicenses(100, 48, 'concurrency');
  const [first, second] = await Promise.all([seedOrganizationAdmin('concurrent-one'), seedOrganizationAdmin('concurrent-two')]);
  const [firstActor, secondActor] = await Promise.all([
    requireActiveOrganizationMemberToken(first.user.idToken, first.organizationId, ['ADMIN']),
    requireActiveOrganizationMemberToken(second.user.idToken, second.organizationId, ['ADMIN']),
  ]);
  const attempts = await Promise.allSettled([
    startSubscriptionTrial(first.organizationId, 'founding_100', firstActor),
    startSubscriptionTrial(second.organizationId, 'founding_100', secondActor),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  const rejected = attempts.find((attempt) => attempt.status === 'rejected');
  assert.equal(rejected?.reason?.status, 409);
  const comparison = await compareFounding100Usage();
  assert.equal(comparison.canonicalEligibleCustomerCount, 150);
  assert.equal(comparison.limit, 150);
  assert.equal((await listPublicSignupPlans()).some((plan) => plan.planId === 'founding_100'), false);

  // Standard has no Founding capacity policy and continues to provision.
  await updateSubscriptionPlan('standard', { publicSignup: true }, { uid: superAdmin.localId, email: superAdmin.email, role: 'SUPER_ADMIN' });
  const standard = await seedOrganizationAdmin('standard-unaffected');
  const standardActor = await requireActiveOrganizationMemberToken(standard.user.idToken, standard.organizationId, ['ADMIN']);
  const standardTrial = await startSubscriptionTrial(standard.organizationId, 'standard', standardActor);
  assert.equal(standardTrial.license.planId, 'standard');

  const audits = await adminDb.collection('platformAuditLogs').where('action', '==', 'FOUNDING_LIMIT_UPDATED').get();
  assert.ok(audits.size >= 3);
  for (const audit of audits.docs) {
    const data = audit.data();
    assert.equal('actorEmail' in data, false);
    assert.equal('targetEmail' in data, false);
    assert.equal('email' in data, false);
    assert.deepEqual(Object.keys(data.metadata || {}).sort(), ['newLimit', 'previousLimit']);
  }
});
