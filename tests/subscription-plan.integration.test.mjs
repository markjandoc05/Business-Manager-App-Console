import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';

const projectId = 'demo-bsm-console';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST || resolveFirebaseProjectIdentity().mode !== 'emulator' || resolveFirebaseProjectIdentity().projectId !== projectId) throw new Error('Refusing subscription-plan integration tests outside the isolated demo Firebase emulators.');

const [{ adminDb }, { DEFAULT_SUBSCRIPTION_PLANS }, { parseCanonicalLicense }, { compareFounding100Usage, listPublicSignupPlans, updateSubscriptionPlan }, { provisionSubscriptionTrial, startSubscriptionTrial, validateSubscriptionEligibility }, { handleClientSubscriptionTrial }, { requireActiveOrganizationMemberToken }] = await Promise.all([
  import('../lib/server/firebase-admin-core.ts'),
  import('../lib/subscription-plan-contract.ts'),
  import('../lib/license-contract.ts'),
  import('../lib/server/subscription-plan-service.ts'),
  import('../lib/server/subscription-license-service.ts'),
  import('../lib/server/client-subscription-handler.ts'),
  import('../lib/server/client-organization-auth.ts'),
]);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
async function createUser(label) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${label}-${suffix}@example.test`, password: 'subscription-plan-test-123', returnSecureToken: true }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'Auth signup failed');
  await adminDb.collection('users').doc(body.localId).set({ uid: body.localId, status: 'active', active: true });
  return body;
}

async function seedPlan(planId, overrides = {}) {
  await adminDb.collection('platformPlans').doc(planId).set({ ...DEFAULT_SUBSCRIPTION_PLANS[planId], ...overrides });
}

test('public signup, tenant authorization, price snapshots, and Founding 100 allocation are server enforced', async () => {
  await seedPlan('founding_100');
  await seedPlan('standard');
  await adminDb.collection('platformPlanUsage').doc('founding_100').set({ eligibleCustomerCount: 99 });
  const orgAdmin = await createUser('organization-admin');
  const orgId = `subscription-plan-org-${suffix}`;
  const orgRef = adminDb.collection('organizations').doc(orgId);
  await orgRef.set({ name: 'Subscription Plan Test Organization' });
  await orgRef.collection('members').doc(orgAdmin.localId).set({ userId: orgAdmin.localId, role: 'ADMIN', status: 'active', email: orgAdmin.email });

  await assert.rejects(
    () => handleClientSubscriptionTrial(orgAdmin.idToken, { organizationId: orgId, planId: 'founding_100', price: 0, trialDays: 365, maxUsers: 99, subscriptionStatus: 'active' }),
    (error) => error?.status === 400,
  );

  let eligibility = await validateSubscriptionEligibility(orgId, 'founding_100');
  assert.equal(eligibility.eligible, true);
  const started = await startSubscriptionTrial(orgId, 'founding_100', await requireActiveOrganizationMemberToken(orgAdmin.idToken, orgId, ['ADMIN']));
  assert.equal(started.license.planId, 'founding_100');
  assert.equal(started.license.status, 'trialing');
  assert.equal(started.license.priceAtSubscription, 99);
  assert.equal(started.license.currency, 'USD');
  assert.equal(started.license.billingInterval, 'year');
  assert.equal((await orgRef.collection('license').doc('current').get()).data().subscriptionStatus, 'trialing');
  assert.equal((await adminDb.collection('platformPlanUsage').doc('founding_100').get()).data().eligibleCustomerCount, 100);
  const retried = await startSubscriptionTrial(orgId, 'founding_100', await requireActiveOrganizationMemberToken(orgAdmin.idToken, orgId, ['ADMIN']));
  assert.equal(retried.idempotent, true);
  assert.equal(retried.auditLogId, null);
  assert.equal((await adminDb.collection('platformPlanUsage').doc('founding_100').get()).data().eligibleCustomerCount, 100);
  const retryEligibility = await validateSubscriptionEligibility(orgId, 'founding_100');
  assert.equal(retryEligibility.eligible, false);
  assert.equal(retryEligibility.idempotent, true);
  const trialAudit = await adminDb.collection('platformAuditLogs').where('organizationId', '==', orgId).get();
  assert.equal(trialAudit.size, 1);
  const trialAuditData = trialAudit.docs[0].data();
  assert.equal(trialAuditData.metadata.licenseCreated, true);
  assert.equal(trialAuditData.metadata.licenseLinked, true);
  for (const privateField of ['actorEmail', 'targetEmail', 'previousValue', 'newValue']) assert.equal(privateField in trialAuditData, false);

  const standardEligibility = await validateSubscriptionEligibility(orgId, 'standard');
  assert.equal(standardEligibility.eligible, false);
  assert.match(standardEligibility.reason, /not currently available/i);
  eligibility = await validateSubscriptionEligibility(`subscription-plan-other-${suffix}`, 'founding_100').catch((error) => ({ error }));
  assert.equal(eligibility.error?.status, 404);

  const otherOrg = `subscription-plan-full-${suffix}`;
  await adminDb.collection('organizations').doc(otherOrg).set({ name: 'Full Founding Organization' });
  const otherUser = await createUser('full-organization-admin');
  await adminDb.collection('organizations').doc(otherOrg).collection('members').doc(otherUser.localId).set({ userId: otherUser.localId, role: 'ADMIN', status: 'active' });
  const fullResult = await startSubscriptionTrial(otherOrg, 'founding_100', await requireActiveOrganizationMemberToken(otherUser.idToken, otherOrg, ['ADMIN'])).catch((error) => ({ error }));
  assert.equal(fullResult.error?.status, 409);
  assert.match(fullResult.error?.message, /limit has been reached/i);

  const publicBefore = await listPublicSignupPlans();
  assert.equal(publicBefore.some((plan) => plan.planId === 'founding_100'), false);
  const platformAdmin = { uid: (await createUser('platform-admin')).localId, email: `platform-admin-${suffix}@example.test`, role: 'SUPER_ADMIN' };
  await assert.rejects(
    () => updateSubscriptionPlan('founding_100', { maxEligibleCustomers: 101 }, platformAdmin),
    (error) => error?.status === 400,
  );
  await assert.rejects(
    () => updateSubscriptionPlan('founding_100', { autoRolloverEnabled: true }, platformAdmin),
    (error) => error?.status === 400,
  );
  await updateSubscriptionPlan('founding_100', { price: 129 }, platformAdmin);
  assert.equal((await orgRef.collection('license').doc('current').get()).data().priceAtSubscription, 99);
  await updateSubscriptionPlan('standard', { publicSignup: true }, platformAdmin);
  await updateSubscriptionPlan('founding_100', { publicSignup: false }, platformAdmin);
  const publicAfter = await listPublicSignupPlans();
  assert.deepEqual(publicAfter.map((plan) => plan.planId), ['standard']);
  const foundingPlanAudit = await adminDb.collection('platformAuditLogs').where('targetId', '==', 'founding_100').get();
  assert.ok(foundingPlanAudit.docs.some((item) => item.data().metadata.publicSignupChanged === true));
  const standardPlanAudit = await adminDb.collection('platformAuditLogs').where('targetId', '==', 'standard').get();
  assert.ok(standardPlanAudit.docs.some((item) => item.data().metadata.publicSignupChanged === true));
});

test('platform admin identity does not bypass Client App tenant membership', async () => {
  const user = await createUser('platform-only');
  const orgId = `subscription-plan-platform-only-${suffix}`;
  await adminDb.collection('organizations').doc(orgId).set({ name: 'Tenant Boundary Organization' });
  await assert.rejects(() => requireActiveOrganizationMemberToken(user.idToken, orgId, ['ADMIN']), (error) => error?.status === 403);
});

test('prepared Client App onboarding payload provisions the tenant and license atomically', async () => {
  await seedPlan('standard', { publicSignup: true });
  const user = await createUser('prepared-onboarding');
  const result = await provisionSubscriptionTrial('standard', { uid: user.localId, email: user.email, displayName: 'Prepared Onboarding User' }, {
    name: 'Prepared Onboarding Workspace', businessType: 'Solo Entrepreneur', phone: '+1 555 0100', website: 'https://example.test', currency: 'USD', timezone: 'Asia/Manila',
  });
  assert.equal(result.workspaceId, result.organizationId);
  assert.equal(result.plan.planId, 'standard');
  assert.equal(result.license.status, 'trialing');
  assert.equal(result.license.planCode, 'standard');
  assert.equal((await adminDb.collection('organizations').doc(result.workspaceId).collection('members').doc(user.localId).get()).data().role, 'ADMIN');
  assert.equal((await adminDb.collection('organizations').doc(result.workspaceId).collection('license').doc('current').get()).data().subscriptionStatus, 'trialing');
  const retried = await provisionSubscriptionTrial('standard', { uid: user.localId, email: user.email, displayName: 'Prepared Onboarding User' }, {
    name: 'Prepared Onboarding Workspace', businessType: 'Solo Entrepreneur', phone: '+1 555 0100', website: 'https://example.test', currency: 'USD', timezone: 'Asia/Manila',
  });
  assert.equal(retried.idempotent, true);
  assert.equal(retried.workspaceId, result.workspaceId);
  assert.equal(retried.auditLogId, null);
  assert.equal((await adminDb.collection('platformPlanUsage').doc('standard').get()).data().eligibleCustomerCount, 1);
  const provisioningAudits = await adminDb.collection('platformAuditLogs').where('organizationId', '==', result.workspaceId).get();
  assert.equal(provisioningAudits.size, 1);
  const provisioningAuditData = provisioningAudits.docs[0].data();
  assert.equal(provisioningAuditData.metadata.provisioning, true);
  for (const privateField of ['actorEmail', 'targetEmail', 'previousValue', 'newValue']) assert.equal(privateField in provisioningAuditData, false);
  await assert.rejects(
    () => provisionSubscriptionTrial('standard', { uid: user.localId, email: user.email, displayName: 'Prepared Onboarding User' }, {
      name: 'Prepared Onboarding Workspace', businessType: 'Solo Entrepreneur', phone: '+1 555 0100', website: 'https://example.test', currency: 'USD', timezone: 'Asia/Manila', price: 0,
    }),
    (error) => error?.status === 400,
  );
});

test('only one concurrent final Founding 100 claim succeeds', async () => {
  await seedPlan('founding_100');
  await adminDb.collection('platformPlanUsage').doc('founding_100').set({ eligibleCustomerCount: 99 });
  const [firstUser, secondUser] = await Promise.all([createUser('concurrent-first'), createUser('concurrent-second')]);
  const firstOrgId = `subscription-plan-concurrent-first-${suffix}`;
  const secondOrgId = `subscription-plan-concurrent-second-${suffix}`;
  await Promise.all([
    adminDb.collection('organizations').doc(firstOrgId).set({ name: 'First concurrent organization' }),
    adminDb.collection('organizations').doc(secondOrgId).set({ name: 'Second concurrent organization' }),
  ]);
  await Promise.all([
    adminDb.collection('organizations').doc(firstOrgId).collection('members').doc(firstUser.localId).set({ userId: firstUser.localId, role: 'ADMIN', status: 'active' }),
    adminDb.collection('organizations').doc(secondOrgId).collection('members').doc(secondUser.localId).set({ userId: secondUser.localId, role: 'ADMIN', status: 'active' }),
  ]);
  const [firstActor, secondActor] = await Promise.all([
    requireActiveOrganizationMemberToken(firstUser.idToken, firstOrgId, ['ADMIN']),
    requireActiveOrganizationMemberToken(secondUser.idToken, secondOrgId, ['ADMIN']),
  ]);
  const attempts = await Promise.allSettled([
    startSubscriptionTrial(firstOrgId, 'founding_100', firstActor),
    startSubscriptionTrial(secondOrgId, 'founding_100', secondActor),
  ]);
  assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1);
  const rejected = attempts.find((item) => item.status === 'rejected');
  assert.equal(rejected?.reason?.status, 409);
  assert.equal((await adminDb.collection('platformPlanUsage').doc('founding_100').get()).data().eligibleCustomerCount, 100);
});

test('a stale low Founding 100 counter cannot admit customer 101', async () => {
  await seedPlan('founding_100');
  const now = Date.now();
  const existing = await adminDb.collectionGroup('license').where('planId', '==', 'founding_100').get();
  const eligible = existing.docs.filter((item) => {
    const canonical = parseCanonicalLicense(item.data());
    if (!canonical || (canonical.subscriptionStatus !== 'trialing' && canonical.subscriptionStatus !== 'active')) return false;
    const end = canonical.subscriptionStatus === 'trialing' ? canonical.trialEndsAt : canonical.subscriptionEndsAt;
    return !end || end.toMillis() > now;
  }).length;
  const batch = adminDb.batch();
  for (let index = eligible; index < 100; index += 1) {
    const orgId = `subscription-plan-stale-counter-${suffix}-${index}`;
    batch.set(adminDb.collection('organizations').doc(orgId).collection('license').doc('current'), {
      organizationId: orgId, planId: 'founding_100', plan: 'TRIAL', status: 'TRIAL', subscriptionStatus: 'trialing', maxUsers: 3, features: {},
      trialStartedAt: new Date(now - 60_000), trialEndsAt: new Date(now + 60_000), priceAtSubscription: 99, currency: 'USD', billingInterval: 'year',
    });
  }
  await batch.commit();
  await adminDb.collection('platformPlanUsage').doc('founding_100').set({ eligibleCustomerCount: 99, marker: 'stale-low-counter' });
  const user = await createUser('stale-counter-admin');
  const orgId = `subscription-plan-stale-counter-request-${suffix}`;
  await adminDb.collection('organizations').doc(orgId).set({ name: 'Stale Counter Request Organization' });
  await adminDb.collection('organizations').doc(orgId).collection('members').doc(user.localId).set({ userId: user.localId, role: 'ADMIN', status: 'active' });
  const actor = await requireActiveOrganizationMemberToken(user.idToken, orgId, ['ADMIN']);
  await assert.rejects(
    () => startSubscriptionTrial(orgId, 'founding_100', actor),
    (error) => error?.status === 409,
  );
  const unchanged = await adminDb.collection('platformPlanUsage').doc('founding_100').get();
  assert.equal(unchanged.data().eligibleCustomerCount, 99);
  assert.equal(unchanged.data().marker, 'stale-low-counter');
});

test('Founding 100 reconciliation comparison is read-only and derives its count from canonical licenses', async () => {
  await seedPlan('founding_100');
  await adminDb.collection('platformPlanUsage').doc('founding_100').set({ eligibleCustomerCount: 37, marker: 'must-not-change' });
  const activeOrg = `subscription-plan-reconcile-active-${suffix}`;
  const expiredOrg = `subscription-plan-reconcile-expired-${suffix}`;
  const now = Date.now();
  const before = await adminDb.collectionGroup('license').where('planId', '==', 'founding_100').get();
  const eligibleBefore = before.docs.filter((item) => {
    const data = item.data();
    const canonical = parseCanonicalLicense(data);
    if (!canonical || (canonical.subscriptionStatus !== 'trialing' && canonical.subscriptionStatus !== 'active')) return false;
    const end = canonical.subscriptionStatus === 'trialing' ? canonical.trialEndsAt : canonical.subscriptionEndsAt;
    return !end || end.toMillis() > now;
  }).length;
  await adminDb.collection('organizations').doc(activeOrg).collection('license').doc('current').set({
    organizationId: activeOrg, planId: 'founding_100', plan: 'TRIAL', status: 'TRIAL', subscriptionStatus: 'trialing', maxUsers: 3, features: {},
    trialStartedAt: new Date(now - 60_000), trialEndsAt: new Date(now + 60_000), priceAtSubscription: 99, currency: 'USD', billingInterval: 'year',
  });
  await adminDb.collection('organizations').doc(expiredOrg).collection('license').doc('current').set({
    organizationId: expiredOrg, planId: 'founding_100', plan: 'TRIAL', status: 'TRIAL', subscriptionStatus: 'trialing', maxUsers: 3, features: {},
    trialStartedAt: new Date(now - 120_000), trialEndsAt: new Date(now - 60_000), priceAtSubscription: 99, currency: 'USD', billingInterval: 'year',
  });
  await adminDb.collection('organizations').doc(`subscription-plan-reconcile-malformed-${suffix}`).collection('license').doc('current').set({
    planId: 'founding_100', subscriptionStatus: 'active', subscriptionEndsAt: new Date(now + 60_000),
  });
  const comparison = await compareFounding100Usage();
  assert.equal(comparison.planId, 'founding_100');
  assert.equal(comparison.storedEligibleCustomerCount, 37);
  assert.equal(comparison.canonicalEligibleCustomerCount, eligibleBefore + 1);
  assert.equal(comparison.difference, 37 - (eligibleBefore + 1));
  assert.equal(comparison.matches, false);
  const unchanged = await adminDb.collection('platformPlanUsage').doc('founding_100').get();
  assert.equal(unchanged.data().eligibleCustomerCount, 37);
  assert.equal(unchanged.data().marker, 'must-not-change');
});
