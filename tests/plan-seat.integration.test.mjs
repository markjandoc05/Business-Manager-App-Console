import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';

const projectId = 'demo-bsm-console';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST || resolveFirebaseProjectIdentity().mode !== 'emulator' || resolveFirebaseProjectIdentity().projectId !== projectId) throw new Error('Refusing plan-seat integration tests outside the isolated demo Firebase emulators.');

const [{ adminAuth, adminDb }, { handleLicenseMutation }, { LICENSE_PLAN_CONFIG }, { requirePlatformAdminToken }, { updateOrganizationMember }] = await Promise.all([
  import('../lib/server/firebase-admin-core.ts'), import('../lib/server/license-handler.ts'), import('../lib/license-contract.ts'), import('../lib/server/platform-admin.ts'), import('../lib/server/organization-admin-service.ts'),
]);
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const future = (days) => new Date(Date.now() + days * 86_400_000);

async function createAdmin() {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `plan-admin-${suffix}@example.test`, password: 'plan-test-password-123', returnSecureToken: true }) });
  const user = await response.json();
  await adminDb.collection('platformAdmins').doc(user.localId).set({ status: 'ACTIVE', role: 'SUPER_ADMIN', email: user.email });
  return user;
}

async function seedOrganization(label, plan, maxUsers, activeCount) {
  const orgId = `plan-seat-${label}-${suffix}`;
  const ref = adminDb.collection('organizations').doc(orgId);
  await ref.set({ name: orgId, status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true });
  await ref.collection('license').doc('current').set({ plan, status: 'ACTIVE', maxUsers, subscriptionStartedAt: new Date(Date.now() - 86_400_000), subscriptionEndsAt: future(365), features: { crm: true } });
  for (let index = 0; index < activeCount; index += 1) await ref.collection('members').doc(`${label}-member-${index}`).set({ userId: `${label}-member-${index}`, role: index === 0 ? 'ADMIN' : 'USER', status: 'active' });
  return { orgId, ref, licenseRef: ref.collection('license').doc('current') };
}

async function mutate(token, orgId, body) {
  try { return { status: 200, data: await handleLicenseMutation(token, orgId, 'change-plan', body) }; } catch (error) { return { status: error.status || 500, error }; }
}

async function state(target) {
  const [licenseSnapshot, organizationSnapshot] = await Promise.all([target.licenseRef.get(), target.ref.get()]);
  const license = licenseSnapshot.data() || {};
  const organization = organizationSnapshot.data() || {};
  return { plan: license.plan, maxUsers: license.maxUsers, mirrorMaxUsers: organization.maxUsers, auditCount: (await adminDb.collection('platformAuditLogs').where('organizationId', '==', target.orgId).get()).size };
}

test('plan mapping, atomic mirrors, forged seat limits, and downgrade guards are deterministic', async () => {
  const admin = await createAdmin();
  for (const [plan, config] of Object.entries(LICENSE_PLAN_CONFIG)) {
    const target = await seedOrganization(`mapping-${plan.toLowerCase()}`, 'TEAM', 7, 1);
    const result = await mutate(admin.idToken, target.orgId, { plan });
    assert.equal(result.status, 200, result.error?.message);
    const current = await state(target);
    assert.equal(current.plan, plan);
    assert.equal(current.maxUsers, config.maxUsers);
    assert.equal(current.mirrorMaxUsers, config.maxUsers);
    assert.equal(current.auditCount, 1);
  }

  const upgrade = await seedOrganization('upgrade', 'SOLO', 1, 1);
  let result = await mutate(admin.idToken, upgrade.orgId, { plan: 'STARTER' });
  assert.equal(result.status, 200, result.error?.message);
  assert.deepEqual(await state(upgrade), { plan: 'STARTER', maxUsers: 3, mirrorMaxUsers: 3, auditCount: 1 });
  const upgradeAudit = await adminDb.collection('platformAuditLogs').where('organizationId', '==', upgrade.orgId).get();
  const upgradeAuditData = upgradeAudit.docs[0].data();
  assert.equal(upgradeAuditData.action, 'ORGANIZATION_PLAN_CHANGED');
  for (const privateField of ['actorEmail', 'targetEmail', 'previousValue', 'newValue']) assert.equal(privateField in upgradeAuditData, false);
  result = await mutate(admin.idToken, upgrade.orgId, { plan: 'TEAM' });
  assert.equal(result.status, 200, result.error?.message);
  assert.deepEqual(await state(upgrade), { plan: 'TEAM', maxUsers: 7, mirrorMaxUsers: 7, auditCount: 2 });

  const downgrade = await seedOrganization('downgrade', 'TEAM', 7, 4);
  const before = await state(downgrade);
  result = await mutate(admin.idToken, downgrade.orgId, { plan: 'STARTER' });
  assert.equal(result.status, 409);
  assert.match(result.error.message, /4 active users.*3/);
  assert.deepEqual(await state(downgrade), before);

  const starterToSoloBlocked = await seedOrganization('starter-solo-blocked', 'STARTER', 3, 2);
  result = await mutate(admin.idToken, starterToSoloBlocked.orgId, { plan: 'SOLO' });
  assert.equal(result.status, 409);
  const starterToSoloPass = await seedOrganization('starter-solo-pass', 'STARTER', 3, 1);
  result = await mutate(admin.idToken, starterToSoloPass.orgId, { plan: 'SOLO' });
  assert.equal(result.status, 200, result.error?.message);
  assert.deepEqual(await state(starterToSoloPass), { plan: 'SOLO', maxUsers: 1, mirrorMaxUsers: 1, auditCount: 1 });

  const forged = await seedOrganization('forged', 'TEAM', 7, 1);
  const forgedBefore = await state(forged);
  result = await mutate(admin.idToken, forged.orgId, { plan: 'SOLO', maxUsers: 999 });
  assert.equal(result.status, 400);
  assert.deepEqual(await state(forged), forgedBefore);

  const soloGuard = await seedOrganization('solo-seat-guard', 'SOLO', 1, 1);
  await soloGuard.ref.collection('members').doc('solo-pending').set({ userId: 'solo-pending', role: 'USER', status: 'pending' });
  const actor = await requirePlatformAdminToken(admin.idToken, ['SUPER_ADMIN']);
  await assert.rejects(() => updateOrganizationMember(soloGuard.orgId, 'solo-pending', { status: 'active' }, actor), (error) => error?.status === 409);
  assert.equal((await soloGuard.ref.collection('members').doc('solo-pending').get()).data().status, 'pending');
});
