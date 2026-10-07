import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';

const projectId = 'demo-bsm-console';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!process.env.FIRESTORE_EMULATOR_HOST || !authHost || resolveFirebaseProjectIdentity().mode !== 'emulator' || resolveFirebaseProjectIdentity().projectId !== projectId) {
  throw new Error('Refusing organization-registration-reset integration tests outside the isolated demo Firebase emulators.');
}

const [{ adminAuth, adminDb }, { DEFAULT_SUBSCRIPTION_PLANS }, { compareSubscriptionPlanUsage }, { POST: registrationResetRoute }] = await Promise.all([
  import('../lib/server/firebase-admin-core.ts'),
  import('../lib/subscription-plan-contract.ts'),
  import('../lib/server/subscription-plan-service.ts'),
  import('../app/api/organizations/[orgId]/registration-reset/route.ts'),
]);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const future = (days) => new Date(Date.now() + days * 86_400_000);

async function createUser(label) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${label}-${suffix}@example.test`, password: 'organization-reset-test-123', returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'Auth signup failed');
  return body;
}

async function requestReset(token, organizationId, body) {
  const response = await registrationResetRoute(new Request(`http://localhost/api/organizations/${organizationId}/registration-reset`, {
    method: 'POST',
    headers: { authorization: token ? `Bearer ${token}` : '', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ orgId: organizationId }) });
  return { status: response.status, body: await response.json() };
}

async function seedOrganization(label, owner, { planId = 'standard', extraMember = false } = {}) {
  const organizationId = `registration-reset-${label}-${suffix}`;
  const organizationRef = adminDb.collection('organizations').doc(organizationId);
  const slug = `registration-reset-${label}-${suffix}`;
  const now = new Date();
  const license = planId === 'founding_100'
    ? {
      organizationId,
      planId,
      entitlementTier: 'STARTER',
      plan: 'TRIAL',
      status: 'TRIAL',
      subscriptionStatus: 'trialing',
      maxUsers: 3,
      features: { crm: true },
      trialStartedAt: now,
      trialEndsAt: future(14),
      priceAtSubscription: 99,
      currency: 'USD',
      billingInterval: 'year',
    }
    : {
      organizationId,
      planId,
      entitlementTier: 'STARTER',
      plan: 'TRIAL',
      status: 'TRIAL',
      subscriptionStatus: 'trialing',
      maxUsers: 3,
      features: { crm: true },
      trialStartedAt: now,
      trialEndsAt: future(14),
      priceAtSubscription: 149,
      currency: 'USD',
      billingInterval: 'year',
    };
  await Promise.all([
    organizationRef.set({ name: `${label} workspace`, slug, createdAt: now }),
    organizationRef.collection('license').doc('current').set(license),
    organizationRef.collection('members').doc(owner.localId).set({ userId: owner.localId, email: owner.email, role: 'ADMIN', status: 'active', createdAt: now }),
    organizationRef.collection('settings').doc('settings').set({ businessName: `${label} workspace`, email: owner.email }),
    // This verifies recursive deletion without returning any CRM value through
    // the reset endpoint.
    organizationRef.collection('leads').doc('private-record').set({ privateValue: `do-not-return-${suffix}` }),
    adminDb.collection('users').doc(owner.localId).set({ uid: owner.localId, email: owner.email, status: 'active' }),
    adminDb.collection('organizationSlugs').doc(slug).set({ organizationId, slug }),
    adminDb.collection('workspaceBootstrap').doc(owner.localId).set({ organizationId, planId }),
    adminDb.collection('organizationInvitations').doc(`invite-${organizationId}`).set({ organizationId, email: `invite-${suffix}@example.test`, status: 'pending' }),
    adminDb.collection('platformProvisioningIdempotency').doc(`replay-${organizationId}`).set({
      uid: owner.localId,
      endpoint: 'POST /api/v1/trials',
      status: 'COMPLETED',
      result: { organizationId, workspaceId: organizationId, license: { plan: 'TRIAL' } },
    }),
  ]);
  if (extraMember) await organizationRef.collection('members').doc(`legacy-${owner.localId}`).set({ role: 'USER', status: 'active' });
  return { organizationId, organizationRef, slug };
}

await Promise.all([
  adminDb.collection('platformPlans').doc('founding_100').set(DEFAULT_SUBSCRIPTION_PLANS.founding_100),
  adminDb.collection('platformPlans').doc('standard').set(DEFAULT_SUBSCRIPTION_PLANS.standard),
]);

test('SUPER_ADMIN full reset removes the organization subtree and trusted signup links, frees an exclusive test account, and reconciles Founding usage', async () => {
  const [superAdmin, owner] = await Promise.all([createUser('reset-super'), createUser('reset-owner')]);
  await adminDb.collection('platformAdmins').doc(superAdmin.localId).set({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
  const target = await seedOrganization('founding', owner, { planId: 'founding_100' });
  await adminDb.collection('platformPlanUsage').doc('founding_100').set({ eligibleCustomerCount: 1 });

  const response = await requestReset(superAdmin.idToken, target.organizationId, { mode: 'DELETE_AUTH', confirmation: target.organizationId });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.organizationAlreadyRemoved, false);
  assert.equal(response.body.data.resetMode, 'DELETE_AUTH');
  assert.equal(response.body.data.deletedAuthUserCount, 1);
  assert.equal(response.body.data.foundingUsageReconciled, true);
  assert.equal((await target.organizationRef.get()).exists, false);
  assert.equal((await target.organizationRef.collection('leads').doc('private-record').get()).exists, false);
  assert.equal((await adminDb.collection('organizationSlugs').doc(target.slug).get()).exists, false);
  assert.equal((await adminDb.collection('workspaceBootstrap').doc(owner.localId).get()).exists, false);
  assert.equal((await adminDb.collection('organizationInvitations').doc(`invite-${target.organizationId}`).get()).exists, false);
  assert.equal((await adminDb.collection('platformProvisioningIdempotency').doc(`replay-${target.organizationId}`).get()).exists, false);
  assert.equal((await adminDb.collection('users').doc(owner.localId).get()).exists, false);
  await assert.rejects(() => adminAuth.getUser(owner.localId));
  assert.equal((await adminDb.collection('platformAdmins').doc(superAdmin.localId).get()).exists, true);
  const usage = await compareSubscriptionPlanUsage('founding_100');
  assert.equal(usage.matches, true);
  const audit = (await adminDb.collection('platformAuditLogs').where('organizationId', '==', target.organizationId).get()).docs.find((document) => document.data().action === 'ORGANIZATION_REGISTRATION_RESET');
  assert.ok(audit);
  assert.equal(audit.data().result, 'SUCCESS');
  assert.equal('actorEmail' in audit.data(), false);
  assert.equal('targetEmail' in audit.data(), false);
  assert.doesNotMatch(JSON.stringify(audit.data()), /@example\.test|do-not-return/);
});

test('organization-only reset preserves the existing Auth account and platform user profile', async () => {
  const [superAdmin, owner] = await Promise.all([createUser('keep-super'), createUser('keep-owner')]);
  await adminDb.collection('platformAdmins').doc(superAdmin.localId).set({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
  const target = await seedOrganization('keep-auth', owner);

  const response = await requestReset(superAdmin.idToken, target.organizationId, { mode: 'KEEP_AUTH', confirmation: target.organizationId });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.deletedAuthUserCount, 0);
  assert.equal((await target.organizationRef.get()).exists, false);
  assert.equal((await adminDb.collection('users').doc(owner.localId).get()).exists, true);
  assert.equal((await adminAuth.getUser(owner.localId)).uid, owner.localId);
  assert.equal((await adminDb.collection('workspaceBootstrap').doc(owner.localId).get()).exists, false);
});

test('a retry can clean trusted residual links after a prior root deletion without deleting an unproven Auth account', async () => {
  const [superAdmin, owner] = await Promise.all([createUser('resume-super'), createUser('resume-owner')]);
  await adminDb.collection('platformAdmins').doc(superAdmin.localId).set({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
  const target = await seedOrganization('resume', owner);
  // Model an interrupted older cleanup: the root is gone while its tenant
  // subcollections and platform-owned global links have not been cleaned.
  await target.organizationRef.delete();

  const response = await requestReset(superAdmin.idToken, target.organizationId, { mode: 'DELETE_AUTH', confirmation: target.organizationId });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.organizationAlreadyRemoved, true);
  assert.equal(response.body.data.deletedAuthUserCount, 0);
  assert.equal((await target.organizationRef.collection('leads').doc('private-record').get()).exists, false);
  assert.equal((await adminDb.collection('organizationSlugs').doc(target.slug).get()).exists, false);
  assert.equal((await adminDb.collection('workspaceBootstrap').doc(owner.localId).get()).exists, false);
  assert.equal((await adminAuth.getUser(owner.localId)).uid, owner.localId);
});

test('full reset fails closed for another organization membership, platform-admin access, invalid confirmation, and non-SUPER_ADMIN callers', async () => {
  const [superAdmin, support, owner, tenant, platformMember] = await Promise.all([
    createUser('guard-super'), createUser('guard-support'), createUser('guard-owner'), createUser('guard-tenant'), createUser('guard-platform-member'),
  ]);
  await Promise.all([
    adminDb.collection('platformAdmins').doc(superAdmin.localId).set({ role: 'SUPER_ADMIN', status: 'ACTIVE' }),
    adminDb.collection('platformAdmins').doc(support.localId).set({ role: 'SUPPORT', status: 'ACTIVE' }),
    adminDb.collection('platformAdmins').doc(platformMember.localId).set({ role: 'SUPPORT', status: 'ACTIVE' }),
  ]);
  const target = await seedOrganization('guard', owner);
  await adminDb.collection('organizations').doc(`other-membership-${suffix}`).set({ name: 'Other' });
  await adminDb.collection('organizations').doc(`other-membership-${suffix}`).collection('members').doc(owner.localId).set({ userId: owner.localId, role: 'USER', status: 'active' });

  let response = await requestReset(superAdmin.idToken, target.organizationId, { mode: 'DELETE_AUTH', confirmation: target.organizationId });
  assert.equal(response.status, 409);
  assert.equal((await target.organizationRef.get()).exists, true);
  assert.equal((await adminAuth.getUser(owner.localId)).uid, owner.localId);
  response = await requestReset(support.idToken, target.organizationId, { mode: 'KEEP_AUTH', confirmation: target.organizationId });
  assert.equal(response.status, 403);
  response = await requestReset(tenant.idToken, target.organizationId, { mode: 'KEEP_AUTH', confirmation: target.organizationId });
  assert.equal(response.status, 403);
  response = await requestReset(superAdmin.idToken, target.organizationId, { mode: 'KEEP_AUTH', confirmation: 'wrong-organization' });
  assert.equal(response.status, 400);

  const platformTarget = await seedOrganization('platform-member', platformMember);
  response = await requestReset(superAdmin.idToken, platformTarget.organizationId, { mode: 'DELETE_AUTH', confirmation: platformTarget.organizationId });
  assert.equal(response.status, 409);
  assert.equal((await platformTarget.organizationRef.get()).exists, true);
  assert.equal((await adminAuth.getUser(platformMember.localId)).uid, platformMember.localId);
});
