import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectId = 'demo-bsm-console';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Refusing to run Console licensing tests without both Firebase emulator hosts.');
}

// Firebase CLI injects GCLOUD_PROJECT and FIREBASE_CONFIG into this child,
// while local .env values may be inherited by the shell. Normalize every
// project identity source only inside the emulator test process.
const environment = {
  ...process.env,
  FIREBASE_ADMIN_PROJECT_ID: projectId,
  BSM_EXPECTED_PROJECT_ID: projectId,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId,
  GOOGLE_CLOUD_PROJECT: projectId,
  GCLOUD_PROJECT: projectId,
  FIREBASE_CONFIG: JSON.stringify({ projectId }),
};

const tsx = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url));
for (const testFile of ['scripts/check-license-integration-imports.mjs', 'tests/console-license-integration.test.mjs']) {
  const result = spawnSync(process.execPath, [tsx, '--test', testFile], { env: environment, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
