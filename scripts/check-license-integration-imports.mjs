import { resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';

const EMULATOR_PROJECT_ID = 'demo-bsm-console';
const productionProjectId = 'bsm-client-app-web';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

if (!firestoreHost || !authHost) {
  throw new Error('Refusing to run licensing import smoke check: FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST are required.');
}
const identity = resolveFirebaseProjectIdentity();
if (identity.mode !== 'emulator' || identity.projectId !== EMULATOR_PROJECT_ID) {
  throw new Error(`Refusing to run licensing import smoke check: project must be ${EMULATOR_PROJECT_ID}.`);
}
if ([firestoreHost, authHost, identity.projectId].some((value) => value.includes(productionProjectId))) {
  throw new Error('Refusing to run licensing import smoke check because production project configuration was detected.');
}

await import('../lib/server/license-handler.ts');
console.log('License integration dependency graph resolved under the TypeScript-aware Node runner.');
