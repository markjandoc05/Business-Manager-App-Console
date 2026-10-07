import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';

const projectId = 'demo-bsm-console';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!process.env.FIRESTORE_EMULATOR_HOST || !authHost || resolveFirebaseProjectIdentity().mode !== 'emulator' || resolveFirebaseProjectIdentity().projectId !== projectId) {
  throw new Error('Refusing organization-operations integration tests outside the isolated demo Firebase emulator.');
}

const [{ adminDb }, { getOrganizationOperationsDetail, listOrganizationRegistryPage }, { GET: listOrganizationsRoute }, { GET: organizationDetailRoute, PATCH: organizationProfileRoute }] = await Promise.all([
  import('../lib/server/firebase-admin-core.ts'),
  import('../lib/server/organization-operations-service.ts'),
  import('../app/api/organizations/route.ts'),
  import('../app/api/organizations/[orgId]/route.ts'),
]);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const organizationId = `organization-operations-${suffix}`;
const organizationRef = adminDb.collection('organizations').doc(organizationId);
const past = (days) => new Date(Date.now() - days * 86_400_000);
const future = (days) => new Date(Date.now() + days * 86_400_000);
const auditCreatedAt = new Date(Date.now() - 86_400_000);

async function createUser(label) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${label}-${suffix}@example.test`, password: 'organization-operations-test-123', returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'Auth signup failed');
  return body;
}

async function callListRoute(token) {
  const response = await listOrganizationsRoute(new Request('http://localhost/api/organizations', { headers: { Authorization: token ? `Bearer ${token}` : '' } }));
  return { status: response.status, body: await response.json() };
}

async function callDetailRoute(token) {
  const response = await organizationDetailRoute(new Request(`http://localhost/api/organizations/${organizationId}`, { headers: { Authorization: token ? `Bearer ${token}` : '' } }), { params: Promise.resolve({ orgId: organizationId }) });
  return { status: response.status, body: await response.json() };
}

async function callProfileRoute(token) {
  const response = await organizationProfileRoute(new Request(`http://localhost/api/organizations/${organizationId}`, {
    method: 'PATCH',
    headers: { Authorization: token ? `Bearer ${token}` : '', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'SUPPORT must not be able to change this' }),
  }), { params: Promise.resolve({ orgId: organizationId }) });
  return { status: response.status, body: await response.json() };
}

async function seedPlatformOrganization() {
  await organizationRef.set({
    name: 'Platform Projection Workspace',
    slug: `platform-projection-${suffix}`,
    ownerEmail: 'owner-private@example.test',
    createdAt: past(10),
    // These unsupported tenant-root values must never enter the platform-safe
    // organization projection.
    installationId: `install-${suffix}`,
    appVersion: 'v2.4.1',
    revision: 'revision-42',
    deploymentStatus: 'CURRENT',
    lastHeartbeatAt: past(1),
  });
  await organizationRef.collection('settings').doc('settings').set({
    website: 'https://tenant.example.test/private-path?email=private@example.test',
    email: 'owner-private@example.test',
    phone: '+15555550123',
    timezone: 'Asia/Manila',
    currency: 'USD',
  });
  await organizationRef.collection('license').doc('current').set({
    organizationId,
    planId: 'standard',
    plan: 'TEAM',
    status: 'ACTIVE',
    subscriptionStatus: 'active',
    maxUsers: 5,
    features: { crm: true, reports: true, documents: true },
    subscriptionStartedAt: past(30),
    subscriptionEndsAt: future(365),
    renewalDate: future(365),
    priceAtSubscription: 149,
    currency: 'USD',
    billingInterval: 'year',
    createdAt: past(30),
    updatedAt: past(1),
  });
  await organizationRef.collection('members').doc(`member-${suffix}`).set({
    userId: `member-${suffix}`,
    name: 'Private Member',
    email: 'member-private@example.test',
    role: 'ADMIN',
    status: 'active',
  });
  await adminDb.collection('platformAuditLogs').doc(`allowed-${suffix}`).set({
    action: 'ORGANIZATION_LICENSE_RENEWED',
    actorEmail: 'platform-admin@example.test',
    actorRole: 'SUPER_ADMIN',
    targetType: 'ORGANIZATION_LICENSE',
    targetId: organizationId,
    targetEmail: 'owner-private@example.test',
    organizationId,
    previousValue: { privateValue: 'do-not-return' },
    newValue: { privateValue: 'still-do-not-return' },
    createdAt: auditCreatedAt,
  });
  await adminDb.collection('platformAuditLogs').doc(`excluded-${suffix}`).set({
    action: 'ORGANIZATION_MEMBER_ADDED',
    actorEmail: 'platform-admin@example.test',
    actorRole: 'SUPER_ADMIN',
    targetType: 'ORGANIZATION_MEMBER',
    targetId: `member-${suffix}`,
    targetEmail: 'member-private@example.test',
    organizationId,
    previousValue: null,
    newValue: { email: 'member-private@example.test' },
    createdAt: new Date(),
  });
}

test('organization registry projects canonical subscription and allowlisted organization metadata only', async () => {
  await seedPlatformOrganization();
  const { items: records } = await listOrganizationRegistryPage({ query: 'Platform Projection Workspace' });
  const record = records.find((item) => item.organizationId === organizationId);
  assert.ok(record);
  assert.equal(record.organizationName, 'Platform Projection Workspace');
  assert.equal(record.platformStatus, 'HEALTHY');
  assert.equal(record.planId, 'standard');
  assert.equal(record.licenseStatus, 'ACTIVE');
  assert.equal(record.canonicalLicenseStatus, 'ACTIVE');
  assert.equal(record.activeSeatCount, 1);
  assert.equal(record.maxUsers, 5);
  assert.equal(record.priceAtSubscription, 149);
  assert.equal(record.platformMetadata.workspaceSlug, `platform-projection-${suffix}`);
  assert.equal('installationId' in record.platformMetadata, false);
  assert.equal('primaryVentaleDomain' in record.platformMetadata, false);
  assert.equal('applicationVersion' in record.platformMetadata, false);

  const serialized = JSON.stringify(record);
  for (const privateValue of ['owner-private@example.test', 'member-private@example.test', 'Private Member', 'private-path', 'crm', 'v2.4.1', 'revision-42', `install-${suffix}`]) {
    assert.doesNotMatch(serialized, new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('organization detail redacts audit identity and values, sanitizes member events, and performs no repair', async () => {
  await seedPlatformOrganization();
  const beforeAuditCount = (await adminDb.collection('platformAuditLogs').where('organizationId', '==', organizationId).get()).size;
  const detail = await getOrganizationOperationsDetail(organizationId);
  const afterAuditCount = (await adminDb.collection('platformAuditLogs').where('organizationId', '==', organizationId).get()).size;
  assert.equal(afterAuditCount, beforeAuditCount);
  assert.equal(detail.organization.organizationId, organizationId);
  assert.equal(detail.organization.platformMetadata.workspaceSlug, `platform-projection-${suffix}`);
  assert.equal('installationId' in detail.organization.platformMetadata, false);
  assert.equal(detail.auditHistory.length, 2);
  assert.deepEqual(detail.auditHistory.find((event) => event.id === `allowed-${suffix}`), {
    id: `allowed-${suffix}`,
    action: 'ORGANIZATION_LICENSE_RENEWED',
    actorRole: 'SUPER_ADMIN',
    createdAt: auditCreatedAt.toISOString(),
  });
  const serialized = JSON.stringify(detail);
  for (const privateValue of ['platform-admin@example.test', 'owner-private@example.test', 'member-private@example.test', 'do-not-return', 'Private Member']) {
    assert.doesNotMatch(serialized, new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('organization registry routes reject non-platform callers and give SUPPORT only the safe read projection', async () => {
  await seedPlatformOrganization();
  const support = await createUser('organization-support');
  const tenant = await createUser('organization-tenant');
  await adminDb.collection('platformAdmins').doc(support.localId).set({ role: 'SUPPORT', status: 'ACTIVE', email: support.email });

  let response = await callListRoute('');
  assert.equal(response.status, 401);
  response = await callListRoute(tenant.idToken);
  assert.equal(response.status, 403);
  response = await callListRoute(support.idToken);
  assert.equal(response.status, 200);
  const record = response.body.data.items.find((item) => item.organizationId === organizationId);
  assert.ok(record);
  assert.equal(record.licenseStatus, 'ACTIVE');
  assert.equal('ownerEmail' in record, false);
  assert.equal('members' in record, false);

  response = await callDetailRoute(support.idToken);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.organization.organizationId, organizationId);
  assert.equal(response.body.data.auditHistory.length, 2);
  assert.equal('actorEmail' in response.body.data.auditHistory[0], false);
  assert.equal('newValue' in response.body.data.auditHistory[0], false);

  response = await callProfileRoute(support.idToken);
  assert.equal(response.status, 403);
  assert.equal((await organizationRef.get()).data().name, 'Platform Projection Workspace');
});
