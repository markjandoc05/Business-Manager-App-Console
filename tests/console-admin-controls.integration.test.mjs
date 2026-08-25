import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';

const projectId = 'demo-bsm-console';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!firestoreHost || !authHost || resolveFirebaseProjectIdentity().mode !== 'emulator' || resolveFirebaseProjectIdentity().projectId !== projectId) throw new Error('Refusing admin-control integration tests outside the isolated demo Firebase emulators.');

const [{ adminAuth, adminDb }, { handleLicenseMutation }, { requirePlatformAdminToken }, { updateOrganizationProfile, updateOrganizationMember, addOrganizationMember }, { getConsoleOrganization }, { GET: lookupMemberRoute, POST: addMemberRoute }, { PATCH: updateMemberRoute }] = await Promise.all([
  import('../lib/server/firebase-admin-core.ts'), import('../lib/server/license-handler.ts'), import('../lib/server/platform-admin.ts'), import('../lib/server/organization-admin-service.ts'), import('../lib/server/console-read-service.ts'), import('../app/api/organizations/[orgId]/members/route.ts'), import('../app/api/organizations/[orgId]/members/[uid]/route.ts'),
]);
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const future = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
const past = (days = 1) => new Date(Date.now() - days * 86_400_000).toISOString();

async function auth(operation, email) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:${operation}?key=demo-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'admin-controls-password-123', returnSecureToken: true }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || `Auth ${operation} failed`);
  return body;
}
async function user(label) { return auth('signUp', `${label}-${suffix}@example.test`); }
async function callLicense(token, orgId, action, body = {}) { try { return { status: 200, data: await handleLicenseMutation(token, orgId, action, body) }; } catch (error) { return { status: error.status || 500, error }; } }
async function callProfile(token, orgId, body) { try { const actor = await requirePlatformAdminToken(token, ['SUPER_ADMIN']); return { status: 200, data: await updateOrganizationProfile(orgId, body, actor) }; } catch (error) { return { status: error.status || 500, error }; } }
async function callMember(token, orgId, uid, body) { try { const actor = await requirePlatformAdminToken(token, ['SUPER_ADMIN']); return { status: 200, data: await updateOrganizationMember(orgId, uid, body, actor) }; } catch (error) { return { status: error.status || 500, error }; } }
async function callAdd(token, orgId, body) { try { const actor = await requirePlatformAdminToken(token, ['SUPER_ADMIN']); return { status: 201, data: await addOrganizationMember(orgId, body, actor) }; } catch (error) { return { status: error.status || 500, error }; } }
async function callRoute(handler, token, orgId, method, body = {}, uid) {
  const request = new Request(`http://localhost/api/organizations/${orgId}/members${uid ? `/${uid}` : ''}`, { method, headers: { Authorization: token ? `Bearer ${token}` : '', 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body) });
  const response = await handler(request, { params: Promise.resolve(uid ? { orgId, uid } : { orgId }) });
  return { status: response.status, body: await response.json() };
}
async function auditCount(orgId) { return (await adminDb.collection('platformAuditLogs').where('organizationId', '==', orgId).get()).size; }
async function seedInvalid(label, memberCount = 1) {
  const orgId = `admin-controls-${label}-${suffix}`;
  const ref = adminDb.collection('organizations').doc(orgId);
  await ref.set({ name: `${label} Organization` });
  await ref.collection('license').doc('current').set({ plan: 'TEAM', status: 'ACTIVE' });
  for (let index = 0; index < memberCount; index += 1) await ref.collection('members').doc(`${label}-member-${index}`).set({ userId: `${label}-member-${index}`, role: index === 0 ? 'ADMIN' : 'USER', status: 'active' });
  return { orgId, ref, licenseRef: ref.collection('license').doc('current') };
}

test('invalid license repair is atomic, authorized, auditable, and seat-safe', async () => {
  const superAdmin = await user('repair-super');
  const support = await user('repair-support');
  const tenant = await user('repair-tenant');
  await adminDb.collection('platformAdmins').doc(superAdmin.localId).set({ role: 'SUPER_ADMIN', status: 'ACTIVE', email: superAdmin.email });
  await adminDb.collection('platformAdmins').doc(support.localId).set({ role: 'SUPPORT', status: 'ACTIVE', email: support.email });
  const invalid = await seedInvalid('repair', 1);
  const before = (await invalid.licenseRef.get()).data();
  const beforeAudits = await auditCount(invalid.orgId);
  let result = await callLicense(superAdmin.idToken, invalid.orgId, 'repair-license', { plan: 'TRIAL', maxUsers: 1, trialStartedAt: past(), trialEndsAt: future(30) });
  assert.equal(result.status, 400);
  assert.deepEqual((await invalid.licenseRef.get()).data(), before);
  assert.equal(await auditCount(invalid.orgId), beforeAudits);
  result = await callLicense(support.idToken, invalid.orgId, 'repair-license', { plan: 'TEAM', maxUsers: 1, subscriptionStartedAt: past(), subscriptionEndsAt: future(365), reason: 'support cannot repair' });
  assert.equal(result.status, 403);
  result = await callLicense(tenant.idToken, invalid.orgId, 'repair-license', { plan: 'TEAM', maxUsers: 1, subscriptionStartedAt: past(), subscriptionEndsAt: future(365), reason: 'tenant cannot repair' });
  assert.equal(result.status, 403);
  result = await callLicense('', invalid.orgId, 'repair-license', { plan: 'TEAM', maxUsers: 1, subscriptionStartedAt: past(), subscriptionEndsAt: future(365), reason: 'anonymous cannot repair' });
  assert.equal(result.status, 401);
  result = await callLicense(superAdmin.idToken, invalid.orgId, 'repair-license', { plan: 'TRIAL', maxUsers: 1, trialStartedAt: past(), trialEndsAt: future(30), reason: 'Legacy organization missing canonical license fields.' });
  assert.equal(result.status, 200, result.error?.message);
  assert.equal((await invalid.licenseRef.get()).data().status, 'TRIAL');
  assert.equal((await invalid.ref.get()).data().licenseStatus, 'TRIAL');
  const audit = await adminDb.collection('platformAuditLogs').where('organizationId', '==', invalid.orgId).get();
  assert.equal(audit.size, 1);
  assert.equal(audit.docs[0].data().action, 'ORGANIZATION_LICENSE_REPAIRED');
  assert.equal(audit.docs[0].data().metadata.reason, 'Legacy organization missing canonical license fields.');

  const invalidPaid = await seedInvalid('repair-paid', 2);
  result = await callLicense(superAdmin.idToken, invalidPaid.orgId, 'repair-license', { plan: 'TEAM', maxUsers: 1, subscriptionStartedAt: past(), subscriptionEndsAt: future(365), reason: 'Repair paid license' });
  assert.equal(result.status, 400);
  result = await callLicense(superAdmin.idToken, invalidPaid.orgId, 'repair-license', { plan: 'TEAM', maxUsers: 2, subscriptionStartedAt: past(), subscriptionEndsAt: future(365), reason: 'Repair paid license' });
  assert.equal(result.status, 200, result.error?.message);
  assert.equal((await invalidPaid.licenseRef.get()).data().status, 'ACTIVE');
  await invalidPaid.licenseRef.set({ plan: 'TEAM', status: 'ACTIVE', maxUsers: 2, subscriptionStartedAt: past(), subscriptionEndsAt: future(365), features: { crm: true } });
  result = await callLicense(superAdmin.idToken, invalidPaid.orgId, 'repair-license', { plan: 'TEAM', maxUsers: 2, subscriptionStartedAt: past(), subscriptionEndsAt: future(365), reason: 'stale repair' });
  assert.equal(result.status, 409);
});

test('organization profile and member controls preserve tenant boundaries, seats, and final-admin safety', async () => {
  const superAdmin = await user('member-super');
  const support = await user('member-support');
  const tenant = await user('member-tenant');
  await adminDb.collection('platformAdmins').doc(superAdmin.localId).set({ role: 'SUPER_ADMIN', status: 'ACTIVE', email: superAdmin.email });
  await adminDb.collection('platformAdmins').doc(support.localId).set({ role: 'SUPPORT', status: 'ACTIVE', email: support.email });
  const orgId = `admin-controls-members-${suffix}`;
  const ref = adminDb.collection('organizations').doc(orgId);
  const adminUid = `admin-${suffix}`;
  const pendingUid = `pending-${suffix}`;
  await ref.set({ name: 'Member Control Organization', businessType: 'SMB' });
  await ref.collection('license').doc('current').set({ plan: 'TEAM', status: 'ACTIVE', maxUsers: 1, subscriptionStartedAt: new Date(), subscriptionEndsAt: new Date(Date.now() + 365 * 86_400_000), features: { crm: true } });
  await ref.collection('members').doc(adminUid).set({ userId: adminUid, role: 'ADMIN', status: 'active' });
  await ref.collection('members').doc(pendingUid).set({ userId: pendingUid, role: 'USER', status: 'pending' });
  let result = await callProfile(superAdmin.idToken, orgId, { name: 'Updated Organization', timezone: 'Asia/Manila', reason: 'Normalize profile' });
  assert.equal(result.status, 200);
  assert.equal((await ref.get()).data().name, 'Updated Organization');
  assert.equal((await ref.collection('settings').doc('settings').get()).data().timezone, 'Asia/Manila');
  assert.equal((await ref.get()).data().timezone, 'Asia/Manila');
  assert.equal((await getConsoleOrganization(orgId)).organization.timezone, 'Asia/Manila');
  await ref.collection('settings').doc('settings').set({ currency: 'USD', timezone: 'America/New_York' }, { merge: true });
  const refreshedOrganization = await getConsoleOrganization(orgId);
  assert.equal(refreshedOrganization.organization.currency, 'USD');
  assert.equal(refreshedOrganization.organization.timezone, 'America/New_York');
  result = await callProfile(superAdmin.idToken, orgId, { currency: 'PHP', reason: 'Use organization billing currency' });
  assert.equal(result.status, 200, result.error?.message);
  assert.equal((await ref.collection('settings').doc('settings').get()).data().currency, 'PHP');
  assert.equal((await ref.get()).data().currency, 'PHP');
  assert.equal((await getConsoleOrganization(orgId)).organization.currency, 'PHP');
  result = await callProfile(superAdmin.idToken, orgId, { slug: 'not-allowed' });
  assert.equal(result.status, 400);
  result = await callProfile(support.idToken, orgId, { name: 'Support cannot edit' });
  assert.equal(result.status, 403);
  result = await callMember(superAdmin.idToken, orgId, adminUid, { role: 'USER' });
  assert.equal(result.status, 409);
  result = await callMember(superAdmin.idToken, orgId, pendingUid, { status: 'active' });
  assert.equal(result.status, 409);
  result = await callMember(support.idToken, orgId, pendingUid, { status: 'active' });
  assert.equal(result.status, 403);
  result = await callMember(tenant.idToken, orgId, pendingUid, { status: 'active' });
  assert.equal(result.status, 403);
  result = await callLicense(superAdmin.idToken, orgId, 'edit-details', { plan: 'TEAM', maxUsers: 2, reason: 'Add one workspace seat' });
  assert.equal(result.status, 200, result.error?.message);
  result = await callMember(superAdmin.idToken, orgId, pendingUid, { role: 'MANAGER', status: 'active', reason: 'Restore workspace access' });
  assert.equal(result.status, 200, result.error?.message);
  assert.equal((await ref.collection('members').doc(pendingUid).get()).data().status, 'active');
  assert.equal(await auditCount(orgId), 4);
});

test('existing-user member add, archive, restore, and seat guards preserve history', async () => {
  const superAdmin = await user('add-super');
  const support = await user('add-support');
  const existing = await user('add-existing');
  const notMember = await user('add-not-member');
  await adminDb.collection('platformAdmins').doc(superAdmin.localId).set({ role: 'SUPER_ADMIN', status: 'ACTIVE', email: superAdmin.email });
  await adminDb.collection('platformAdmins').doc(support.localId).set({ role: 'SUPPORT', status: 'ACTIVE', email: support.email });
  const orgId = `admin-controls-add-${suffix}`;
  const ref = adminDb.collection('organizations').doc(orgId);
  const adminUid = `add-admin-${suffix}`;
  await ref.set({ name: 'Add Member Organization' });
  await ref.collection('license').doc('current').set({ plan: 'TEAM', status: 'ACTIVE', maxUsers: 2, subscriptionStartedAt: new Date(), subscriptionEndsAt: new Date(Date.now() + 365 * 86_400_000), features: { crm: true } });
  await ref.collection('members').doc(adminUid).set({ userId: adminUid, email: 'admin@example.test', role: 'ADMIN', status: 'active' });
  let result = await callAdd(superAdmin.idToken, orgId, { email: existing.email, role: 'USER', reason: 'Add existing BSM user' });
  assert.equal(result.status, 201, result.error?.stack || result.error?.message);
  assert.equal((await ref.collection('members').doc(existing.localId).get()).data().status, 'active');
  result = await callAdd(superAdmin.idToken, orgId, { email: existing.email, role: 'USER' });
  assert.equal(result.status, 409);
  result = await callAdd(superAdmin.idToken, orgId, { email: 'missing-account@example.test', role: 'USER' });
  assert.equal(result.status, 404);
  const third = await user('add-third');
  result = await callAdd(superAdmin.idToken, orgId, { email: third.email, role: 'USER' });
  assert.equal(result.status, 409);
  result = await callAdd(support.idToken, orgId, { email: notMember.email, role: 'USER' });
  assert.equal(result.status, 403);
  result = await callMember(superAdmin.idToken, orgId, existing.localId, { status: 'archived', reason: 'Remove organization access' });
  assert.equal(result.status, 200);
  assert.equal((await ref.collection('members').doc(existing.localId).get()).data().status, 'archived');
  result = await callAdd(superAdmin.idToken, orgId, { email: third.email, role: 'USER' });
  assert.equal(result.status, 201, result.error?.stack || result.error?.message);
  result = await callMember(superAdmin.idToken, orgId, existing.localId, { status: 'active', reason: 'Restore organization access' });
  assert.equal(result.status, 409);
  result = await callMember(superAdmin.idToken, orgId, third.localId, { status: 'archived' });
  assert.equal(result.status, 200);
  result = await callMember(superAdmin.idToken, orgId, existing.localId, { status: 'active', reason: 'Restore organization access' });
  assert.equal(result.status, 200);
  result = await callMember(superAdmin.idToken, orgId, adminUid, { status: 'suspended' });
  assert.equal(result.status, 409);
  result = await callMember(superAdmin.idToken, orgId, adminUid, { role: 'USER' });
  assert.equal(result.status, 409);
  assert.equal((await ref.collection('members').doc(adminUid).get()).data().status, 'active');
  const audit = await adminDb.collection('platformAuditLogs').where('organizationId', '==', orgId).get();
  assert.ok(audit.docs.some((doc) => doc.data().action === 'ORGANIZATION_MEMBER_ADDED'));
  assert.ok(audit.docs.some((doc) => doc.data().action === 'ORGANIZATION_MEMBER_ARCHIVED'));
  assert.ok(audit.docs.some((doc) => doc.data().action === 'ORGANIZATION_MEMBER_RESTORED'));
});

test('member API routes enforce platform authorization and expose the shared mutation contract', async () => {
  const superAdmin = await user('route-super');
  const support = await user('route-support');
  const tenant = await user('route-tenant');
  const existing = await user('route-existing');
  await adminDb.collection('platformAdmins').doc(superAdmin.localId).set({ role: 'SUPER_ADMIN', status: 'ACTIVE', email: superAdmin.email });
  await adminDb.collection('platformAdmins').doc(support.localId).set({ role: 'SUPPORT', status: 'ACTIVE', email: support.email });
  const orgId = `admin-controls-routes-${suffix}`;
  const ref = adminDb.collection('organizations').doc(orgId);
  await ref.set({ name: 'Member Route Organization' });
  await ref.collection('license').doc('current').set({ plan: 'TEAM', status: 'ACTIVE', maxUsers: 2, subscriptionStartedAt: new Date(), subscriptionEndsAt: new Date(Date.now() + 365 * 86_400_000), features: { crm: true } });
  const adminUid = `route-admin-${suffix}`;
  await ref.collection('members').doc(adminUid).set({ userId: adminUid, email: 'route-admin@example.test', role: 'ADMIN', status: 'active' });

  let result = await callRoute(addMemberRoute, '', orgId, 'POST', { email: existing.email, role: 'USER' });
  assert.equal(result.status, 401);
  result = await callRoute(addMemberRoute, support.idToken, orgId, 'POST', { email: existing.email, role: 'USER' });
  assert.equal(result.status, 403);
  result = await callRoute(lookupMemberRoute, tenant.idToken, orgId, 'GET');
  assert.equal(result.status, 403);
  result = await callRoute(addMemberRoute, superAdmin.idToken, orgId, 'POST', { email: existing.email, role: 'USER' });
  assert.equal(result.status, 201, result.body.error?.message);
  assert.equal(result.body.data.member.status, 'active');
  result = await callRoute(updateMemberRoute, superAdmin.idToken, orgId, 'PATCH', { role: 'MANAGER' }, existing.localId);
  assert.equal(result.status, 200, result.body.error?.message);
  assert.equal(result.body.data.after.role, 'MANAGER');
  result = await callRoute(updateMemberRoute, support.idToken, orgId, 'PATCH', { status: 'suspended' }, existing.localId);
  assert.equal(result.status, 403);
  result = await callRoute(updateMemberRoute, superAdmin.idToken, orgId, 'PATCH', { status: 'active' }, `missing-${suffix}`);
  assert.equal(result.status, 404);
});
