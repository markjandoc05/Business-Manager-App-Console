import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { DEFAULT_FOUNDING_CUSTOMER_LIMIT, DEFAULT_SUBSCRIPTION_PLANS } from '../lib/subscription-plan-contract.ts';

const PROJECT_ID = 'bsm-client-app-web';
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const confirmationIndex = process.argv.indexOf('--confirm-project-id');
const confirmation = confirmationIndex >= 0 ? process.argv[confirmationIndex + 1]?.trim() : undefined;

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Plan bootstrap refuses to run while emulator environment variables are set.');
if (process.env.FIREBASE_ADMIN_PROJECT_ID !== PROJECT_ID) throw new Error(`Plan bootstrap requires FIREBASE_ADMIN_PROJECT_ID=${PROJECT_ID}.`);
if (apply && confirmation !== PROJECT_ID) throw new Error('Apply mode requires --confirm-project-id bsm-client-app-web.');

const existingApp = getApps()[0];
if (existingApp?.options.projectId && existingApp.options.projectId !== PROJECT_ID) throw new Error(`Plan bootstrap rejects existing Firebase Admin app project ${existingApp.options.projectId}.`);
const app = existingApp || initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const firestore = getFirestore(app);
const entries = Object.values(DEFAULT_SUBSCRIPTION_PLANS);
const missing = [];
const foundingLimitBackfills = [];

for (const plan of entries) {
  const ref = firestore.collection('platformPlans').doc(plan.planId);
  const snapshot = await ref.get();
  if (snapshot.exists) {
    const data = snapshot.data() || {};
    if (plan.planId === 'founding_100' && !Object.prototype.hasOwnProperty.call(data, 'foundingLimit')) {
      // Only a known legacy document (`maxEligibleCustomers: 100`) can be
      // backfilled automatically. Any other shape is deliberately left for
      // an operator review rather than guessing a commercial capacity.
      if (data.maxEligibleCustomers === DEFAULT_FOUNDING_CUSTOMER_LIMIT) {
        foundingLimitBackfills.push(plan);
        console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', planId: plan.planId, status: 'MISSING_FOUNDING_LIMIT' }));
      } else {
        console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', planId: plan.planId, status: 'FOUNDING_LIMIT_REQUIRES_REVIEW' }));
      }
    } else console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', planId: plan.planId, status: 'EXISTS' }));
    continue;
  }
  missing.push(plan);
  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', planId: plan.planId, status: 'MISSING' }));
}

if (apply) {
  const batch = firestore.batch();
  for (const plan of missing) batch.set(firestore.collection('platformPlans').doc(plan.planId), { ...plan, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: 'bootstrap' });
  for (const plan of foundingLimitBackfills) batch.update(firestore.collection('platformPlans').doc(plan.planId), {
    foundingLimit: DEFAULT_FOUNDING_CUSTOMER_LIMIT,
    maxEligibleCustomers: DEFAULT_FOUNDING_CUSTOMER_LIMIT,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: 'bootstrap',
  });
  if (missing.length || foundingLimitBackfills.length) await batch.commit();
  console.log(JSON.stringify({ mode: 'APPLY', projectId: PROJECT_ID, created: missing.map((plan) => plan.planId), backfilledFoundingLimit: foundingLimitBackfills.map((plan) => plan.planId), message: 'No production deployment was performed.' }));
} else {
  console.log(JSON.stringify({ mode: 'DRY_RUN', projectId: PROJECT_ID, wouldCreate: missing.map((plan) => plan.planId), wouldBackfillFoundingLimit: foundingLimitBackfills.map((plan) => plan.planId), message: 'Re-run with --apply --confirm-project-id bsm-client-app-web to create missing plans and backfill only known legacy Founding capacity documents.' }));
}
