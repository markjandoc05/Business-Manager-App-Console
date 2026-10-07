import { FieldValue } from 'firebase-admin/firestore';
import { EMULATOR_FIREBASE_PROJECT_ID, resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';
import { adminDb } from '../lib/server/firebase-admin-core.ts';
import { bootstrapDefaultSubscriptionPlans } from '../lib/server/subscription-plan-service.ts';

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

if (!firestoreHost || !authHost) {
  throw new Error('Refusing local catalog bootstrap: FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST are both required.');
}

const identity = resolveFirebaseProjectIdentity();
if (identity.mode !== 'emulator' || identity.projectId !== EMULATOR_FIREBASE_PROJECT_ID) {
  throw new Error(`Refusing local catalog bootstrap: only the ${EMULATOR_FIREBASE_PROJECT_ID} Firebase emulator project is allowed.`);
}

const result = await bootstrapDefaultSubscriptionPlans({
  uid: 'local-emulator-bootstrap',
  email: 'local-emulator@example.invalid',
  role: 'SUPER_ADMIN',
});

const usageRef = adminDb.collection('platformPlanUsage').doc('founding_100');
const usageCreated = await adminDb.runTransaction(async (transaction) => {
  const usage = await transaction.get(usageRef);
  if (usage.exists) return false;
  transaction.set(usageRef, {
    eligibleCustomerCount: 0,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return true;
});

console.log(JSON.stringify({
  projectId: identity.projectId,
  mode: identity.mode,
  plansCreated: result.created,
  foundingUsageCreated: usageCreated,
}));
