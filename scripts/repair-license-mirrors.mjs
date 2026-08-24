import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { buildOrganizationLicenseMirror, parseCanonicalLicense } from '../lib/license-contract.ts';
import { loadLicenseMirrorState } from '../lib/license-mirror.ts';

const PROJECT_ID = 'bsm-client-app-web';
const DATABASE_ID = '(default)';
const args = new Set(process.argv.slice(2));
const orgArgIndex = process.argv.indexOf('--org-id');
const confirmArgIndex = process.argv.indexOf('--confirm-org-id');
const orgId = orgArgIndex >= 0 ? process.argv[orgArgIndex + 1]?.trim() : undefined;
const confirmation = confirmArgIndex >= 0 ? process.argv[confirmArgIndex + 1]?.trim() : undefined;
const apply = args.has('--apply');

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Repair CLI refuses to run while emulator environment variables are set.');
if (process.env.FIREBASE_ADMIN_PROJECT_ID !== PROJECT_ID) throw new Error(`Repair CLI requires FIREBASE_ADMIN_PROJECT_ID=${PROJECT_ID}.`);
for (const name of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT']) {
  if (process.env[name] && process.env[name] !== PROJECT_ID) throw new Error(`Repair CLI rejects ${name} because it does not equal ${PROJECT_ID}.`);
}
if (apply && (!orgId || confirmation !== orgId)) throw new Error('Apply mode requires --org-id ID and --confirm-org-id ID with the same value.');

const existingApp = getApps()[0];
if (existingApp?.options.projectId && existingApp.options.projectId !== PROJECT_ID) throw new Error(`Repair CLI rejects existing Firebase Admin app project ${existingApp.options.projectId}.`);
const app = existingApp || initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const firestore = getFirestore(app, DATABASE_ID);
const organizations = orgId ? [orgId] : (await firestore.collection('organizations').get()).docs.map((item) => item.id);

function printable(value) {
  if (value && typeof value === 'object' && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(printable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, printable(item)]));
  return value;
}

for (const organizationId of organizations) {
  const state = await loadLicenseMirrorState({ firestore, organizationId });
  const result = { mode: apply ? 'APPLY' : 'DRY_RUN', projectId: PROJECT_ID, databaseId: DATABASE_ID, organizationId, canonicalPath: `organizations/${organizationId}/license/current`, organizationExists: state.organization.exists, canonicalExists: state.canonical.exists, status: state.status, differences: printable(state.differences) };
  if (state.canonical.exists) {
    result.canonicalFields = Object.keys(state.canonical.data() || {});
    result.canonicalPlan = state.parsedCanonicalLicense?.plan;
    result.canonicalStatus = state.parsedCanonicalLicense?.status;
    result.canonicalMaxUsers = state.parsedCanonicalLicense?.maxUsers;
  }
  console.log(JSON.stringify(result));
  if (!apply || state.status !== 'DRIFTED') continue;
  if (!state.organization.exists || !state.parsedCanonicalLicense || !state.derivedMirror) throw new Error(`${organizationId}: apply safety check failed before write.`);
  if (state.differences.some(({ field }) => !['licenseStatus', 'licenseWriteEnabled', 'licenseExpiresAt', 'maxUsers'].includes(field))) throw new Error(`${organizationId}: drift includes a forbidden repair field.`);

  await firestore.runTransaction(async (transaction) => {
    const organizationRef = firestore.collection('organizations').doc(organizationId);
    const canonicalRef = organizationRef.collection('license').doc('current');
    const [organizationSnapshot, canonicalSnapshot] = await Promise.all([transaction.get(organizationRef), transaction.get(canonicalRef)]);
    if (!organizationSnapshot.exists || !canonicalSnapshot.exists) throw new Error(`${organizationId}: state changed or is no longer safely repairable.`);
    const currentLicense = parseCanonicalLicense(canonicalSnapshot.data() || {});
    if (!currentLicense) throw new Error(`${organizationId}: canonical license became invalid before write.`);
    transaction.set(organizationRef, buildOrganizationLicenseMirror(currentLicense), { merge: true });
  });

  const verified = await loadLicenseMirrorState({ firestore, organizationId });
  if (verified.status !== 'CONSISTENT') throw new Error(`${organizationId}: POST_WRITE_VERIFICATION_FAILED`);
  console.log(JSON.stringify({ mode: 'APPLY', organizationId, status: 'CONSISTENT', repairedFields: ['licenseStatus', 'licenseWriteEnabled', 'licenseExpiresAt', 'maxUsers'] }));
}
