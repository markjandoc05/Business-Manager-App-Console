import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';

const PROJECT_ID = 'demo-bsm-console';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!process.env.FIRESTORE_EMULATOR_HOST || !authHost || resolveFirebaseProjectIdentity().mode !== 'emulator' || resolveFirebaseProjectIdentity().projectId !== PROJECT_ID) {
  throw new Error('Refusing subscription-operations pagination tests outside isolated demo Firebase emulators.');
}

const [{ adminDb }, { DEFAULT_SUBSCRIPTION_PLANS }, { GET: licensePageRoute }, { GET: overviewRoute }] = await Promise.all([
  import('../lib/server/firebase-admin-core.ts'),
  import('../lib/subscription-plan-contract.ts'),
  import('../app/api/subscription-operations/licenses/route.ts'),
  import('../app/api/subscription-operations/route.ts'),
]);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function createUser() {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `subscription-page-${suffix}@example.test`, password: 'subscription-pagination-123', returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'Auth signup failed');
  return body;
}

async function callPage(token, query = '') {
  const request = new Request(`http://localhost/api/subscription-operations/licenses${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const response = await licensePageRoute(request);
  return { status: response.status, body: await response.json() };
}

async function callOverview(token) {
  const response = await overviewRoute(new Request('http://localhost/api/subscription-operations', { headers: token ? { Authorization: `Bearer ${token}` } : {} }));
  return { status: response.status, body: await response.json() };
}

test('license records use bounded server-side cursor pages and retain platform-admin access control', async () => {
  const admin = await createUser();
  await adminDb.collection('platformAdmins').doc(admin.localId).set({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
  await Promise.all([
    adminDb.collection('platformPlans').doc('founding_100').set(DEFAULT_SUBSCRIPTION_PLANS.founding_100),
    adminDb.collection('platformPlans').doc('standard').set(DEFAULT_SUBSCRIPTION_PLANS.standard),
  ]);
  const batch = adminDb.batch();
  const now = Date.now();
  for (let index = 0; index < 28; index += 1) {
    const organizationId = `subscription-page-${suffix}-${String(index).padStart(2, '0')}`;
    const organization = adminDb.collection('organizations').doc(organizationId);
    batch.set(organization, { name: `Paged licenses ${String(index).padStart(2, '0')}` });
    batch.set(organization.collection('license').doc('current'), {
      organizationId, planId: 'standard', plan: 'STARTER', status: 'ACTIVE', subscriptionStatus: 'active', maxUsers: 3,
      features: { crm: true }, subscriptionStartedAt: new Date(now - 86_400_000), subscriptionEndsAt: new Date(now + 86_400_000), renewalDate: new Date(now + 86_400_000),
      priceAtSubscription: 149, currency: 'USD', billingInterval: 'year', createdAt: new Date(now - 86_400_000), updatedAt: new Date(now), updatedBy: 'pagination-test',
    });
  }
  await batch.commit();

  const encodedQuery = `?query=${encodeURIComponent('Paged licenses')}`;
  assert.equal((await callPage('', encodedQuery)).status, 401);
  assert.equal((await callOverview('')).status, 401);
  const overview = await callOverview(admin.idToken);
  assert.equal(overview.status, 200);
  assert.equal('licenses' in overview.body.data, false);
  assert.equal(overview.body.data.overview.standardSubscriptionCount, 28);
  assert.equal(overview.body.data.overview.activeCount, 28);
  assert.equal(overview.body.data.overview.upcomingRenewals.length, 10);
  const first = await callPage(admin.idToken, encodedQuery);
  assert.equal(first.status, 200);
  assert.equal(first.body.data.licenses.length, 25);
  assert.equal(first.body.data.hasMore, true);
  assert.ok(first.body.data.nextCursor);
  assert.ok(first.body.data.licenses.every((license) => license.organizationName.startsWith('Paged licenses')));

  const second = await callPage(admin.idToken, `${encodedQuery}&cursor=${encodeURIComponent(first.body.data.nextCursor)}`);
  assert.equal(second.status, 200);
  assert.equal(second.body.data.licenses.length, 3);
  assert.equal(second.body.data.hasMore, false);
  assert.equal(second.body.data.nextCursor, undefined);
  const ids = new Set([...first.body.data.licenses, ...second.body.data.licenses].map((license) => license.organizationId));
  assert.equal(ids.size, 28);

  const invalid = await callPage(admin.idToken, '?status=NOT_A_STATUS');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'INVALID_REQUEST');
});
