import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';

const projectId = 'demo-bsm-console';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!process.env.FIRESTORE_EMULATOR_HOST || !authHost || resolveFirebaseProjectIdentity().mode !== 'emulator' || resolveFirebaseProjectIdentity().projectId !== projectId) {
  throw new Error('Refusing Audit Logs integration tests outside the isolated demo Firebase emulators.');
}

const [{ adminDb }, { GET: auditLogsRoute }, { getDashboardMetrics }] = await Promise.all([
  import('../lib/server/firebase-admin-core.ts'),
  import('../app/api/audit-logs/route.ts'),
  import('../lib/server/dashboard-service.ts'),
]);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const planAuditAction = `TEST_AUDIT_PLAN_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const organizationId = `audit-log-org-${suffix}`;
const otherOrganizationId = `audit-log-other-${suffix}`;
const auditDay = new Date(Date.now() - 60_000).toISOString().slice(0, 10);

async function createUser(label) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${label}-${suffix}@example.test`, password: 'audit-logs-test-password', returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'Auth signup failed');
  return body;
}

async function callRoute(token, parameters = {}) {
  const params = new URLSearchParams(parameters);
  const response = await auditLogsRoute(new Request(`http://localhost/api/audit-logs?${params.toString()}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }));
  return { status: response.status, body: await response.json() };
}

test('Audit Logs are redacted, server-filtered, paginated, support-readable, and read-only', async () => {
  const [support, tenant] = await Promise.all([createUser('support'), createUser('tenant-admin')]);
  await adminDb.collection('platformAdmins').doc(support.localId).set({ status: 'ACTIVE', role: 'SUPPORT', email: support.email });
  const base = Date.now();
  await Promise.all([
    adminDb.collection('platformAuditLogs').doc(`plan-${suffix}`).set({
      action: planAuditAction, actorEmail: 'private-platform-admin@example.test', actorRole: 'SUPER_ADMIN', targetType: 'SUBSCRIPTION_PLAN', targetId: 'founding_100', result: 'SUCCESS',
      previousValue: { price: 99, secret: 'do-not-return' }, newValue: { price: 149, token: 'do-not-return-token' }, metadata: { changedFields: ['price', 'publicSignup', 'not_allowed'], publicSignupChanged: true, nextPublicSignup: false, planId: 'founding_100' }, createdAt: new Date(base),
    }),
    adminDb.collection('platformAuditLogs').doc(`license-${suffix}`).set({
      action: 'ORGANIZATION_LICENSE_RENEWED', actorEmail: 'private-platform-admin@example.test', actorRole: 'SUPER_ADMIN', targetType: 'ORGANIZATION_LICENSE', targetId: organizationId, organizationId,
      previousValue: { email: 'customer-private@example.test' }, newValue: { licenseKey: 'private-key' }, metadata: { planId: 'standard', entitlementTier: 'STARTER' }, createdAt: new Date(base - 1_000),
    }),
    adminDb.collection('platformAuditLogs').doc(`member-${suffix}`).set({
      action: 'ORGANIZATION_MEMBER_ADDED', actorEmail: 'private-platform-admin@example.test', actorRole: 'SUPER_ADMIN', targetType: 'ORGANIZATION_MEMBER', targetId: 'member-private-id', targetEmail: 'member-private@example.test', organizationId,
      previousValue: null, newValue: { email: 'member-private@example.test', notes: 'private-note' }, metadata: { reason: 'private reason' }, createdAt: new Date(base - 2_000),
    }),
    adminDb.collection('platformAuditLogs').doc(`other-${suffix}`).set({
      action: 'ORGANIZATION_PROFILE_UPDATED', actorEmail: 'other-private@example.test', actorRole: 'SUPER_ADMIN', targetType: 'ORGANIZATION', targetId: otherOrganizationId, organizationId: otherOrganizationId,
      previousValue: { name: 'Private customer' }, newValue: { name: 'Still private' }, metadata: {}, createdAt: new Date(base - 3_000),
    }),
  ]);
  const auditBefore = await adminDb.collection('platformAuditLogs').get();

  assert.equal((await callRoute()).status, 401);
  assert.equal((await callRoute(tenant.idToken)).status, 403);

  const filtered = await callRoute(support.idToken, { action: planAuditAction, targetType: 'SUBSCRIPTION_PLAN', actorRole: 'SUPER_ADMIN', dateFrom: auditDay, dateTo: auditDay });
  assert.equal(filtered.status, 200, JSON.stringify(filtered.body));
  assert.equal(filtered.body.data.items.length, 1);
  const planEvent = filtered.body.data.items[0];
  assert.deepEqual(planEvent.details, ['Changed: price, public signup', 'Public signup: disabled', 'Plan: founding_100']);
  assert.equal(planEvent.targetId, 'founding_100');
  assert.equal(planEvent.actorRole, 'SUPER_ADMIN');
  assert.equal(planEvent.result, 'SUCCESS');

  const organizationFiltered = await callRoute(support.idToken, { organizationId, targetType: 'ORGANIZATION_MEMBER' });
  assert.equal(organizationFiltered.status, 200);
  assert.equal(organizationFiltered.body.data.items.length, 1);
  assert.equal(organizationFiltered.body.data.items[0].targetId, undefined);
  assert.equal(organizationFiltered.body.data.items[0].organizationId, organizationId);

  const paged = await callRoute(support.idToken, { limit: '1' });
  assert.equal(paged.status, 200);
  assert.equal(paged.body.data.items.length, 1);
  assert.ok(paged.body.data.nextCursor);
  const laterPage = await callRoute(support.idToken, { limit: '1', cursor: paged.body.data.nextCursor });
  assert.equal(laterPage.status, 200);
  assert.equal(laterPage.body.data.items.length, 1);
  assert.notEqual(laterPage.body.data.items[0].id, paged.body.data.items[0].id);

  const serialized = JSON.stringify(filtered.body.data);
  for (const privateValue of ['private-platform-admin@example.test', 'customer-private@example.test', 'member-private@example.test', 'do-not-return', 'do-not-return-token', 'private-note', 'private reason', 'previousValue', 'newValue']) {
    assert.doesNotMatch(serialized, new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.equal((await callRoute(support.idToken, { organizationId: 'not valid!' })).status, 400);
  assert.equal((await callRoute(support.idToken, { dateFrom: '2026-02-30' })).status, 400);

  const dashboard = await getDashboardMetrics();
  const dashboardSerialized = JSON.stringify(dashboard.recentActivity);
  for (const privateValue of ['private-platform-admin@example.test', 'customer-private@example.test', 'member-private@example.test', 'do-not-return', 'do-not-return-token', 'private-note', 'private reason', 'previousValue', 'newValue']) {
    assert.doesNotMatch(dashboardSerialized, new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const auditAfter = await adminDb.collection('platformAuditLogs').get();
  assert.equal(auditAfter.size, auditBefore.size);
});
