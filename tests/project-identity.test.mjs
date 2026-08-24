import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMULATOR_FIREBASE_PROJECT_ID, PRODUCTION_FIREBASE_PROJECT_ID, resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';

const production = { FIREBASE_ADMIN_PROJECT_ID: PRODUCTION_FIREBASE_PROJECT_ID, GOOGLE_CLOUD_PROJECT: PRODUCTION_FIREBASE_PROJECT_ID };
const emulator = {
  GOOGLE_CLOUD_PROJECT: EMULATOR_FIREBASE_PROJECT_ID,
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
};
const isolatedEmulator = {
  FIREBASE_ADMIN_PROJECT_ID: EMULATOR_FIREBASE_PROJECT_ID,
  BSM_EXPECTED_PROJECT_ID: EMULATOR_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: EMULATOR_FIREBASE_PROJECT_ID,
  GOOGLE_CLOUD_PROJECT: EMULATOR_FIREBASE_PROJECT_ID,
  GCLOUD_PROJECT: EMULATOR_FIREBASE_PROJECT_ID,
  FIREBASE_CONFIG: JSON.stringify({ projectId: EMULATOR_FIREBASE_PROJECT_ID }),
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
};

function rejects(environment, existingAppProjectId) {
  assert.throws(() => resolveFirebaseProjectIdentity(environment, existingAppProjectId));
}

test('production identity is accepted only when the effective project is bsm-client-app-web', () => {
  assert.deepEqual(resolveFirebaseProjectIdentity({
    ...production,
    GOOGLE_CLOUD_PROJECT: PRODUCTION_FIREBASE_PROJECT_ID,
    GCLOUD_PROJECT: PRODUCTION_FIREBASE_PROJECT_ID,
    BSM_EXPECTED_PROJECT_ID: PRODUCTION_FIREBASE_PROJECT_ID,
  }), { projectId: PRODUCTION_FIREBASE_PROJECT_ID, mode: 'production' });
});

test('a different GOOGLE_CLOUD_PROJECT is rejected', () => rejects({ ...production, GOOGLE_CLOUD_PROJECT: 'other-project' }));
test('a different GCLOUD_PROJECT is rejected', () => rejects({ ...production, GCLOUD_PROJECT: 'other-project' }));
test('contradictory project identifiers are rejected', () => rejects({ FIREBASE_ADMIN_PROJECT_ID: PRODUCTION_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'other-project' }));
test('missing effective project identity is rejected', () => rejects({}));
test('a valid Firebase Admin project ID is accepted as the production runtime identity', () => {
  assert.deepEqual(resolveFirebaseProjectIdentity({ FIREBASE_ADMIN_PROJECT_ID: PRODUCTION_FIREBASE_PROJECT_ID }), { projectId: PRODUCTION_FIREBASE_PROJECT_ID, mode: 'production' });
});

test('the Console demo project is accepted only with both emulator hosts', () => {
  assert.deepEqual(resolveFirebaseProjectIdentity(emulator), { projectId: EMULATOR_FIREBASE_PROJECT_ID, mode: 'emulator' });
});

test('fully isolated emulator identity accepts every available demo source', () => {
  assert.deepEqual(resolveFirebaseProjectIdentity(isolatedEmulator), { projectId: EMULATOR_FIREBASE_PROJECT_ID, mode: 'emulator' });
});

test('inherited production client identity remains rejected in an emulator environment', () => {
  rejects({ ...isolatedEmulator, NEXT_PUBLIC_FIREBASE_PROJECT_ID: PRODUCTION_FIREBASE_PROJECT_ID });
});

test('a demo project without emulator conditions is rejected', () => rejects({ FIREBASE_ADMIN_PROJECT_ID: EMULATOR_FIREBASE_PROJECT_ID }));
test('production project during emulator execution is rejected', () => rejects({ ...emulator, FIREBASE_ADMIN_PROJECT_ID: PRODUCTION_FIREBASE_PROJECT_ID }));
test('partial emulator configuration is rejected instead of falling through to production', () => rejects({ FIREBASE_ADMIN_PROJECT_ID: PRODUCTION_FIREBASE_PROJECT_ID, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }));
test('a contradictory existing Admin app project is rejected', () => rejects(production, 'other-project'));
test('a contradictory expected project is rejected', () => rejects({ ...production, BSM_EXPECTED_PROJECT_ID: 'other-project' }));
