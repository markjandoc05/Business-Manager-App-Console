import assert from 'node:assert/strict';
import { test } from 'node:test';

import { adminDb } from '../lib/server/firebase-admin-core.ts';
import { requirePlatformAdminToken } from '../lib/server/platform-admin.ts';
import { getOrganizationUsage, recalculateOrganizationUsage, setOrganizationStorageLimit } from '../lib/server/organization-usage-service.ts';

const projectId = 'demo-bsm-console';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!firestoreHost || !authHost || process.env.BSM_EXPECTED_PROJECT_ID !== projectId) throw new Error('Refusing organization usage integration tests outside the isolated demo Firebase emulators.');

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function auth(operation, email) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:${operation}?key=demo-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'organization-usage-password-123', returnSecureToken: true }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || `Auth ${operation} failed`);
  return body;
}

async function user(label) { return auth('signUp', `${label}-${suffix}@example.test`); }

test('usage reads are role-gated and reconciliation stores bounded operational summaries', async () => {
  const superAdmin = await user('usage-super');
  const support = await user('usage-support');
  const tenant = await user('usage-tenant');
  await adminDb.collection('platformAdmins').doc(superAdmin.localId).set({ role: 'SUPER_ADMIN', status: 'ACTIVE', email: superAdmin.email });
  await adminDb.collection('platformAdmins').doc(support.localId).set({ role: 'SUPPORT', status: 'ACTIVE', email: support.email });
  const superActor = await requirePlatformAdminToken(superAdmin.idToken, ['SUPER_ADMIN']);
  const supportActor = await requirePlatformAdminToken(support.idToken, ['SUPPORT']);
  const orgId = `usage-${suffix}`;
  const orgRef = adminDb.collection('organizations').doc(orgId);
  await orgRef.set({ name: 'Usage Test Organization' });
  const missing = await getOrganizationUsage(orgId);
  assert.equal(missing.usageAvailable, false);
  await orgRef.collection('members').doc('admin').set({ role: 'ADMIN', status: 'active', userId: 'admin' });
  await orgRef.collection('members').doc('user').set({ role: 'USER', status: 'active', userId: 'user' });
  await Promise.all([
    orgRef.collection('leads').doc('lead-1').set({ name: 'Lead 1' }),
    orgRef.collection('leads').doc('lead-2').set({ name: 'Lead 2' }),
    orgRef.collection('clients').doc('client-1').set({ name: 'Client 1' }),
    orgRef.collection('deals').doc('deal-1').set({ value: 100 }),
    orgRef.collection('tasks').doc('task-1').set({ title: 'Task 1' }),
    orgRef.collection('tasks').doc('task-2').set({ title: 'Task 2' }),
    orgRef.collection('activities').doc('activity-1').set({ action: 'created' }),
  ]);
  const supportRead = await getOrganizationUsage(orgId);
  assert.equal(supportRead.usageAvailable, false);
  await assert.rejects(() => recalculateOrganizationUsage(orgId, supportActor), (error) => error.status === 403);
  await assert.rejects(() => requirePlatformAdminToken(tenant.idToken), (error) => error.status === 403);
  await assert.rejects(() => requirePlatformAdminToken(''), (error) => error.status === 401);
  const calculated = await recalculateOrganizationUsage(orgId, superActor);
  assert.equal(calculated.usageAvailable, true);
  assert.equal(calculated.recordCount, 9);
  assert.equal(calculated.breakdown.leads, 2);
  assert.equal(calculated.breakdown.clients, 1);
  assert.equal(calculated.breakdown.members, 2);
  assert.ok(calculated.firestoreBytesEstimated > 0);
  assert.equal(calculated.storageBytes, 0);
  const stored = await orgRef.collection('usage').doc('current').get();
  assert.equal(stored.data().recordCount, 9);
  const audits = await adminDb.collection('platformAuditLogs').where('organizationId', '==', orgId).get();
  assert.equal(audits.docs.filter((item) => item.data().action === 'ORGANIZATION_USAGE_RECALCULATED').length, 1);
  await assert.rejects(() => setOrganizationStorageLimit(orgId, 1024, supportActor), (error) => error.status === 403);
  const limited = await setOrganizationStorageLimit(orgId, 1024 * 1024, superActor);
  assert.equal(limited.storageLimitBytes, 1024 * 1024);
  assert.equal(limited.usageStatus, 'UNAVAILABLE');
  assert.equal(limited.storageAvailable, false);
  assert.equal(limited.usageCoverage, 'PARTIAL');
  const emptyId = `usage-empty-${suffix}`;
  await adminDb.collection('organizations').doc(emptyId).set({ name: 'Empty Usage Organization' });
  const empty = await recalculateOrganizationUsage(emptyId, superActor);
  assert.equal(empty.recordCount, 0);
  assert.equal(empty.fileCount, 0);
  assert.equal(empty.totalBytesEstimated, empty.firestoreBytesEstimated);
});
