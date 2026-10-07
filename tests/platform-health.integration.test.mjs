import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';

const projectId = 'demo-bsm-console';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!process.env.FIRESTORE_EMULATOR_HOST || !authHost || resolveFirebaseProjectIdentity().mode !== 'emulator' || resolveFirebaseProjectIdentity().projectId !== projectId) {
  throw new Error('Refusing Platform Health integration tests outside the isolated demo Firebase emulators.');
}

const [{ adminDb }, { DEFAULT_SUBSCRIPTION_PLANS }, { GET: platformHealthRoute }] = await Promise.all([
  import('../lib/server/firebase-admin-core.ts'),
  import('../lib/subscription-plan-contract.ts'),
  import('../app/api/platform-health/route.ts'),
]);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const organizationId = `platform-health-${suffix}`;
const future = (days) => new Date(Date.now() + days * 86_400_000);
const past = (days) => new Date(Date.now() - days * 86_400_000);

async function createUser(label) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${label}-${suffix}@example.test`, password: 'platform-health-test-password', returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'Auth signup failed');
  return body;
}

async function callRoute(token) {
  const response = await platformHealthRoute(new Request('http://localhost/api/platform-health', { headers: token ? { Authorization: `Bearer ${token}` } : {} }));
  return { status: response.status, body: await response.json() };
}

test('Platform Health is read-only, support-readable, and reports subscription integrity warnings', async () => {
  const support = await createUser('support');
  await adminDb.collection('platformAdmins').doc(support.localId).set({ status: 'ACTIVE', role: 'SUPPORT', email: support.email });
  await adminDb.collection('platformPlans').doc('founding_100').set(DEFAULT_SUBSCRIPTION_PLANS.founding_100);
  await adminDb.collection('platformPlanUsage').doc('founding_100').set({ eligibleCustomerCount: 0, marker: 'health-read-only' });
  const organizationRef = adminDb.collection('organizations').doc(organizationId);
  await organizationRef.set({ name: 'Platform Health Test Organization' });
  await organizationRef.collection('license').doc('current').set({
    organizationId,
    planId: 'founding_100',
    entitlementTier: 'STARTER',
    plan: 'TRIAL',
    status: 'TRIAL',
    subscriptionStatus: 'trialing',
    maxUsers: 3,
    features: {},
    trialStartedAt: past(1),
    trialEndsAt: future(14),
    priceAtSubscription: 99,
    currency: 'USD',
    billingInterval: 'year',
  });
  const auditBefore = await adminDb.collection('platformAuditLogs').get();

  const unauthenticated = await callRoute();
  assert.equal(unauthenticated.status, 401);

  const result = await callRoute(support.idToken);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.success, true);
  assert.equal(result.body.data.status, 'DEGRADED');
  assert.deepEqual(result.body.data.summary, { totalOrganizations: 1, activeLicenses: 0, trialLicenses: 1, expiredLicenses: 0, suspendedLicenses: 0 });
  assert.equal(result.body.data.checks.find((check) => check.id === 'FIRESTORE').status, 'HEALTHY');
  assert.equal(result.body.data.checks.find((check) => check.id === 'FIREBASE_ADMIN_AUTH').status, 'HEALTHY');
  assert.equal(result.body.data.checks.find((check) => check.id === 'PLAN_CATALOG').status, 'DEGRADED');
  assert.equal(result.body.data.checks.find((check) => check.id === 'LICENSE_MIRRORS').status, 'DEGRADED');
  assert.ok(result.body.data.warnings.some((warning) => warning.code === 'PLATFORM_PLAN_MISSING'));
  assert.ok(result.body.data.warnings.some((warning) => warning.code === 'FOUNDING_100_USAGE_MISMATCH'));
  assert.ok(result.body.data.warnings.some((warning) => warning.code === 'ORGANIZATION_LICENSE_MIRROR_INCONSISTENT'));

  const [usageAfter, auditAfter] = await Promise.all([
    adminDb.collection('platformPlanUsage').doc('founding_100').get(),
    adminDb.collection('platformAuditLogs').get(),
  ]);
  assert.equal(usageAfter.data()?.eligibleCustomerCount, 0);
  assert.equal(usageAfter.data()?.marker, 'health-read-only');
  assert.equal(auditAfter.size, auditBefore.size);
});
