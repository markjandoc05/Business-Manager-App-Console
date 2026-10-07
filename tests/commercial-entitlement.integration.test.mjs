import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';

const PROJECT_ID = 'demo-bsm-console';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST || resolveFirebaseProjectIdentity().mode !== 'emulator' || resolveFirebaseProjectIdentity().projectId !== PROJECT_ID) {
  throw new Error('Refusing commercial-entitlement integration tests outside the isolated demo Firebase emulators.');
}

const [firebase, plans, licenses, planService, subscriptionService, clientHandler, clientAuth, licenseService] = await Promise.all([
  import('../lib/server/firebase-admin-core.ts'),
  import('../lib/subscription-plan-contract.ts'),
  import('../lib/license-contract.ts'),
  import('../lib/server/subscription-plan-service.ts'),
  import('../lib/server/subscription-license-service.ts'),
  import('../lib/server/client-subscription-handler.ts'),
  import('../lib/server/client-organization-auth.ts'),
  import('../lib/server/license-service.ts'),
]);

const { adminDb } = firebase;
const { DEFAULT_SUBSCRIPTION_PLANS } = plans;
const { LICENSE_PLAN_CONFIG, buildOrganizationLicenseMirror, parseCanonicalLicense } = licenses;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let sequence = 0;
const id = (prefix) => `${prefix}-${suffix}-${++sequence}`;

async function createUser(label) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${label}-${suffix}@example.test`, password: 'commercial-entitlement-test-123', returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'Auth signup failed');
  await adminDb.collection('users').doc(body.localId).set({ uid: body.localId, status: 'active', active: true });
  return body;
}

async function seedPlan(planId, overrides = {}) {
  await adminDb.collection('platformPlans').doc(planId).set({ ...DEFAULT_SUBSCRIPTION_PLANS[planId], ...overrides });
}

async function seedOrganizationWithAdmin(label) {
  const organizationId = id(label);
  const user = await createUser(label);
  const organizationRef = adminDb.collection('organizations').doc(organizationId);
  await organizationRef.set({ status: 'active', name: label });
  await organizationRef.collection('members').doc(user.localId).set({ userId: user.localId, role: 'ADMIN', status: 'active', email: user.email });
  return { organizationId, organizationRef, user, actor: () => clientAuth.requireActiveOrganizationMemberToken(user.idToken, organizationId, ['ADMIN']) };
}

function legacyTrial(organizationId, now = Date.now()) {
  return {
    organizationId,
    plan: 'TRIAL',
    status: 'TRIAL',
    maxUsers: 3,
    features: { crm: true, reports: true, documents: true },
    trialStartedAt: new Date(now - 60_000),
    trialEndsAt: new Date(now + 86_400_000),
    createdAt: new Date(now - 60_000),
    updatedAt: new Date(now - 60_000),
  };
}

function legacyActive(organizationId, now = Date.now()) {
  return {
    organizationId,
    plan: 'TEAM',
    status: 'ACTIVE',
    maxUsers: 7,
    features: { crm: true, reports: true, documents: true },
    subscriptionStartedAt: new Date(now - 60_000),
    subscriptionEndsAt: new Date(now + 86_400_000),
    createdAt: new Date(now - 60_000),
    updatedAt: new Date(now - 60_000),
  };
}

test('commercial trials derive the stable STARTER tier, seat limit, mirrors, and idempotent result server-side', async () => {
  await seedPlan('founding_100');
  await adminDb.collection('platformPlanUsage').doc('founding_100').set({ eligibleCustomerCount: 0 });
  const fixture = await seedOrganizationWithAdmin('commercial-founding');

  await assert.rejects(
    () => subscriptionService.validateSubscriptionEligibility(fixture.organizationId, 'unknown_product'),
    (error) => error?.status === 400,
  );

  await assert.rejects(
    () => clientHandler.handleClientSubscriptionTrial(fixture.user.idToken, {
      organizationId: fixture.organizationId,
      planId: 'founding_100',
      entitlementTier: 'TEAM',
      maxUsers: 99,
      seatLimit: 99,
      storageLimitBytes: 1,
    }),
    (error) => error?.status === 400,
  );

  const started = await subscriptionService.startSubscriptionTrial(fixture.organizationId, 'founding_100', await fixture.actor());
  const [licenseSnapshot, organizationSnapshot, counterSnapshot] = await Promise.all([
    fixture.organizationRef.collection('license').doc('current').get(),
    fixture.organizationRef.get(),
    adminDb.collection('platformPlanUsage').doc('founding_100').get(),
  ]);
  const rawLicense = licenseSnapshot.data();
  const canonical = parseCanonicalLicense(rawLicense);
  assert.equal(started.plan.planId, 'founding_100');
  assert.equal(started.license.status, 'trialing');
  assert.equal(canonical?.plan, 'TRIAL');
  assert.equal(canonical?.entitlementTier, 'STARTER');
  assert.equal(canonical?.maxUsers, LICENSE_PLAN_CONFIG.STARTER.maxUsers);
  assert.equal('storageLimitBytes' in rawLicense, false);
  const mirrors = buildOrganizationLicenseMirror(canonical, Date.now());
  assert.equal(organizationSnapshot.data().licenseStatus, mirrors.licenseStatus);
  assert.equal(organizationSnapshot.data().licenseWriteEnabled, mirrors.licenseWriteEnabled);
  assert.equal(organizationSnapshot.data().maxUsers, mirrors.maxUsers);
  assert.equal(organizationSnapshot.data().licenseExpiresAt.toMillis(), canonical.trialEndsAt.toMillis());
  assert.equal(counterSnapshot.data().eligibleCustomerCount, 1);
  const trialAudits = await adminDb.collection('platformAuditLogs').where('organizationId', '==', fixture.organizationId).get();
  assert.equal(trialAudits.size, 1);
  assert.equal(trialAudits.docs[0].data().metadata.entitlementTier, 'STARTER');
  assert.equal(trialAudits.docs[0].data().metadata.maxUsers, LICENSE_PLAN_CONFIG.STARTER.maxUsers);
  assert.equal(trialAudits.docs[0].data().metadata.storageLimitBytes, null);

  const retried = await subscriptionService.startSubscriptionTrial(fixture.organizationId, 'founding_100', await fixture.actor());
  assert.equal(retried.idempotent, true);
  assert.equal(parseCanonicalLicense((await fixture.organizationRef.collection('license').doc('current').get()).data())?.entitlementTier, 'STARTER');
  assert.equal((await adminDb.collection('platformPlanUsage').doc('founding_100').get()).data().eligibleCustomerCount, 1);
  assert.equal((await adminDb.collection('platformAuditLogs').where('organizationId', '==', fixture.organizationId).get()).size, 1);
});

test('commercial conversion ignores a browser-selected paid tier and preserves the frozen STARTER mapping', async () => {
  await seedPlan('standard', { publicSignup: true });
  const fixture = await seedOrganizationWithAdmin('commercial-standard');
  await subscriptionService.startSubscriptionTrial(fixture.organizationId, 'standard', await fixture.actor());
  const now = Date.now();
  const result = await licenseService.mutateLicense(fixture.organizationId, 'convert-to-paid', {
    // The old Console action form still submits these values. The backend
    // intentionally derives STARTER/3 from the linked commercial product.
    plan: 'TEAM',
    maxUsers: 99,
    subscriptionStartedAt: new Date(now).toISOString(),
    subscriptionEndsAt: new Date(now + 365 * 86_400_000).toISOString(),
  }, { uid: 'commercial-test-super-admin', email: 'commercial-test-super-admin@example.test', role: 'SUPER_ADMIN' });
  assert.equal(result.license.plan, 'STARTER');
  assert.equal(result.license.entitlementTier, 'STARTER');
  assert.equal(result.license.maxUsers, LICENSE_PLAN_CONFIG.STARTER.maxUsers);
  const canonical = parseCanonicalLicense((await fixture.organizationRef.collection('license').doc('current').get()).data());
  assert.equal(canonical?.plan, 'STARTER');
  assert.equal(canonical?.entitlementTier, 'STARTER');
  assert.equal(canonical?.maxUsers, LICENSE_PLAN_CONFIG.STARTER.maxUsers);
  const audit = (await adminDb.collection('platformAuditLogs').where('organizationId', '==', fixture.organizationId).get()).docs.find((item) => item.data().action === 'ORGANIZATION_TRIAL_CONVERTED_TO_PAID');
  assert.equal(audit?.data().metadata.entitlementTier, 'STARTER');
  assert.equal(audit?.data().metadata.maxUsers, LICENSE_PLAN_CONFIG.STARTER.maxUsers);
});

test('existing V1 active and trial licenses are returned safely without duplicate trials or commercial relabeling', async () => {
  await seedPlan('founding_100');
  const beforeUsage = (await adminDb.collection('platformPlanUsage').doc('founding_100').get()).data()?.eligibleCustomerCount || 0;
  const active = await seedOrganizationWithAdmin('legacy-active');
  const trial = await seedOrganizationWithAdmin('legacy-trial');
  await Promise.all([
    active.organizationRef.collection('license').doc('current').set(legacyActive(active.organizationId)),
    trial.organizationRef.collection('license').doc('current').set(legacyTrial(trial.organizationId)),
  ]);

  const [activeResult, trialResult] = await Promise.all([
    subscriptionService.startSubscriptionTrial(active.organizationId, 'founding_100', await active.actor()),
    subscriptionService.startSubscriptionTrial(trial.organizationId, 'founding_100', await trial.actor()),
  ]);
  assert.equal(activeResult.legacy, true);
  assert.equal(trialResult.legacy, true);
  assert.equal(parseCanonicalLicense((await active.organizationRef.collection('license').doc('current').get()).data())?.plan, 'TEAM');
  assert.equal(parseCanonicalLicense((await trial.organizationRef.collection('license').doc('current').get()).data())?.plan, 'TRIAL');
  assert.equal(activeResult.plan, null);
  assert.equal(trialResult.plan, null);
  assert.equal((await active.organizationRef.collection('license').doc('current').get()).data().planId, undefined);
  assert.equal((await trial.organizationRef.collection('license').doc('current').get()).data().planId, undefined);
  assert.equal((await adminDb.collection('platformPlanUsage').doc('founding_100').get()).data()?.eligibleCustomerCount || 0, beforeUsage);
  assert.equal((await adminDb.collection('platformAuditLogs').where('organizationId', 'in', [active.organizationId, trial.organizationId]).get()).size, 0);
});

test('workspace provisioning detects a V1 member/license before creating a duplicate tenant or trial', async () => {
  await seedPlan('standard', { publicSignup: true });
  const user = await createUser('legacy-provisioning');
  const organizationId = id('legacy-provisioned-org');
  const organizationRef = adminDb.collection('organizations').doc(organizationId);
  await organizationRef.set({ status: 'active', name: 'Existing V1 Workspace' });
  await organizationRef.collection('members').doc(user.localId).set({ userId: user.localId, role: 'ADMIN', status: 'active', email: user.email });
  await organizationRef.collection('license').doc('current').set(legacyTrial(organizationId));
  const result = await subscriptionService.provisionSubscriptionTrial('standard', { uid: user.localId, email: user.email, displayName: 'Legacy user' }, {
    name: 'Would Duplicate Workspace', businessType: 'Solo Entrepreneur', phone: '', website: '', currency: 'USD', timezone: 'Asia/Manila',
  });
  assert.equal(result.idempotent, true);
  assert.equal(result.legacy, true);
  assert.equal(result.workspaceId, organizationId);
  assert.equal(result.plan, null);
  assert.equal((await adminDb.collection('organizationSlugs').doc('would-duplicate-workspace').get()).exists, false);
  assert.equal((await adminDb.collection('workspaceBootstrap').doc(user.localId).get()).exists, false);
});

test('authenticated tenant membership remains required and cannot cross organization boundaries', async () => {
  await seedPlan('standard', { publicSignup: true });
  const owner = await seedOrganizationWithAdmin('tenant-owner');
  const outsider = await createUser('tenant-outsider');
  await assert.rejects(
    () => clientHandler.handleClientSubscriptionTrial(outsider.idToken, { organizationId: owner.organizationId, planId: 'standard' }),
    (error) => error?.status === 403,
  );
  assert.equal((await owner.organizationRef.collection('license').doc('current').get()).exists, false);
});

test('catalog mapping edits fail closed and cannot mutate an existing license snapshot', async () => {
  await seedPlan('standard', { publicSignup: true });
  const actor = { uid: 'commercial-test-catalog-admin', email: 'catalog-admin@example.test', role: 'SUPER_ADMIN' };
  await assert.rejects(
    () => planService.updateSubscriptionPlan('standard', { entitlementTier: 'TEAM' }, actor),
    (error) => error?.status === 400,
  );
  const fixture = await seedOrganizationWithAdmin('catalog-snapshot');
  await subscriptionService.startSubscriptionTrial(fixture.organizationId, 'standard', await fixture.actor());
  await adminDb.collection('platformPlans').doc('standard').update({ entitlementTier: 'TEAM' });
  await assert.rejects(
    () => planService.getSubscriptionPlan('standard'),
    (error) => error?.status === 409,
  );
  const canonical = parseCanonicalLicense((await fixture.organizationRef.collection('license').doc('current').get()).data());
  assert.equal(canonical?.entitlementTier, 'STARTER');
  assert.equal(canonical?.plan, 'TRIAL');
});
