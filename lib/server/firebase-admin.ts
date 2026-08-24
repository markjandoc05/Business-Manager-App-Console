import 'server-only';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const expectedProjectId = process.env.BSM_EXPECTED_PROJECT_ID || 'bsm-client-app-web';
const configuredProjectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
export function assertFirebaseProject() {
  if (configuredProjectId && configuredProjectId !== expectedProjectId) throw new Error(`Firebase project mismatch. Expected: ${expectedProjectId}. Server: ${configuredProjectId}.`);
}

const adminApp = getApps().length
  ? getApps()[0]
  : initializeApp(
      process.env.FIREBASE_ADMIN_CLIENT_EMAIL && process.env.FIREBASE_ADMIN_PRIVATE_KEY
        ? {
            credential: cert({
              projectId: process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
              clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
              privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
            }),
          }
        : {
            credential: applicationDefault(),
            projectId: process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
          },
    );

export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
