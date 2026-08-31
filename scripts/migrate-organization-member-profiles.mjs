import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'bsm-client-app-web';
const args = new Set(process.argv.slice(2));
const orgArgIndex = process.argv.indexOf('--org-id');
const confirmArgIndex = process.argv.indexOf('--confirm-org-id');
const organizationId = orgArgIndex >= 0 ? process.argv[orgArgIndex + 1]?.trim() : undefined;
const confirmation = confirmArgIndex >= 0 ? process.argv[confirmArgIndex + 1]?.trim() : undefined;
const apply = args.has('--apply');

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Profile migration refuses to run while emulator environment variables are set.');
if (process.env.FIREBASE_ADMIN_PROJECT_ID !== PROJECT_ID) throw new Error(`Profile migration requires FIREBASE_ADMIN_PROJECT_ID=${PROJECT_ID}.`);
for (const name of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT']) {
  if (process.env[name] && process.env[name] !== PROJECT_ID) throw new Error(`Profile migration rejects ${name} because it does not equal ${PROJECT_ID}.`);
}
if (apply && (!organizationId || confirmation !== organizationId)) throw new Error('Apply mode requires --org-id ID and --confirm-org-id ID with the same value.');

const existingApp = getApps()[0];
if (existingApp?.options.projectId && existingApp.options.projectId !== PROJECT_ID) throw new Error(`Profile migration rejects existing Firebase Admin app project ${existingApp.options.projectId}.`);
const app = existingApp || initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const auth = getAuth(app);
const firestore = getFirestore(app);
const organizations = organizationId
  ? [firestore.collection('organizations').doc(organizationId)]
  : (await firestore.collection('organizations').get()).docs.map((item) => item.ref);

const validRoles = new Set(['ADMIN', 'MANAGER', 'USER']);
const activeMember = (data) => data?.status === 'active' && typeof data?.userId === 'string' && data.userId.trim();
const resultCounts = { inspected: 0, alreadyCanonical: 0, repaired: 0, skipped: 0 };

for (const organizationRef of organizations) {
  const organizationSnapshot = await organizationRef.get();
  if (!organizationSnapshot.exists) {
    console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', projectId: PROJECT_ID, organizationId: organizationRef.id, status: 'SKIPPED', reason: 'ORGANIZATION_NOT_FOUND' }));
    continue;
  }

  const members = await organizationRef.collection('members').get();
  for (const memberSnapshot of members.docs) {
    resultCounts.inspected += 1;
    const member = memberSnapshot.data() || {};
    const uid = typeof member.userId === 'string' ? member.userId.trim() : '';
    const base = { mode: apply ? 'APPLY' : 'DRY_RUN', projectId: PROJECT_ID, organizationId: organizationRef.id, memberPath: memberSnapshot.ref.path, uid };
    if (!activeMember(member)) {
      resultCounts.skipped += 1;
      console.log(JSON.stringify({ ...base, status: 'SKIPPED', reason: 'NOT_ACTIVE_CANONICAL_UID_MEMBERSHIP' }));
      continue;
    }

    let authUser;
    try {
      authUser = await auth.getUser(uid);
    } catch (error) {
      resultCounts.skipped += 1;
      console.log(JSON.stringify({ ...base, status: 'SKIPPED', reason: error?.code === 'auth/user-not-found' ? 'AUTH_USER_NOT_FOUND' : 'AUTH_LOOKUP_FAILED' }));
      continue;
    }
    if (authUser.disabled) {
      resultCounts.skipped += 1;
      console.log(JSON.stringify({ ...base, status: 'SKIPPED', reason: 'AUTH_USER_DISABLED' }));
      continue;
    }

    const profileRef = firestore.collection('users').doc(uid);
    const profileSnapshot = await profileRef.get();
    const profile = profileSnapshot.data() || {};
    const canonical = profileSnapshot.exists && profile.uid === uid && profile.status === 'active' && profile.active !== false;
    if (canonical) {
      resultCounts.alreadyCanonical += 1;
      console.log(JSON.stringify({ ...base, status: 'ALREADY_CANONICAL' }));
      continue;
    }

    const profileUpdate = {
      uid,
      name: authUser.displayName || (typeof profile.name === 'string' ? profile.name : typeof member.name === 'string' ? member.name : authUser.email || 'User'),
      email: authUser.email || (typeof profile.email === 'string' ? profile.email : typeof member.email === 'string' ? member.email : ''),
      displayName: authUser.displayName || (typeof profile.displayName === 'string' ? profile.displayName : typeof member.displayName === 'string' ? member.displayName : typeof member.name === 'string' ? member.name : 'User'),
      photoURL: authUser.photoURL || (typeof profile.photoURL === 'string' ? profile.photoURL : ''),
      role: validRoles.has(profile.role) ? profile.role : validRoles.has(member.role) ? member.role : 'USER',
      status: 'active',
      active: true,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'organization-member-profile-migration',
      ...(profileSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    };
    console.log(JSON.stringify({ ...base, status: apply ? 'REPAIRING' : 'REPAIR_REQUIRED', profilePath: profileRef.path }));
    if (!apply) continue;

    await firestore.runTransaction(async (transaction) => {
      const [currentMember, currentProfile] = await Promise.all([transaction.get(memberSnapshot.ref), transaction.get(profileRef)]);
      const currentMemberData = currentMember.data() || {};
      if (!currentMember.exists || !activeMember(currentMemberData) || currentMemberData.userId !== uid) throw new Error(`${memberSnapshot.ref.path}: membership changed before repair; rerun the dry run.`);
      const currentProfileData = currentProfile.data() || {};
      transaction.set(profileRef, {
        ...profileUpdate,
        name: authUser.displayName || (typeof currentProfileData.name === 'string' ? currentProfileData.name : typeof currentMemberData.name === 'string' ? currentMemberData.name : authUser.email || 'User'),
        displayName: authUser.displayName || (typeof currentProfileData.displayName === 'string' ? currentProfileData.displayName : typeof currentMemberData.displayName === 'string' ? currentMemberData.displayName : typeof currentMemberData.name === 'string' ? currentMemberData.name : 'User'),
        ...(currentProfile.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      }, { merge: true });
    });
    resultCounts.repaired += 1;
  }
}

console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', projectId: PROJECT_ID, organizationId: organizationId || null, counts: resultCounts }));
