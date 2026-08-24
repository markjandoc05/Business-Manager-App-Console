import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const expectedProjectId = 'bsm-client-app-web';
if (typeof window !== 'undefined' && firebaseConfig.projectId !== expectedProjectId) {
  throw new Error(`Firebase project mismatch. Expected: ${expectedProjectId}. Client: ${firebaseConfig.projectId || 'missing'}.`);
}

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const firebaseAuth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);
