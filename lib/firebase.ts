import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

const PRODUCTION_FIREBASE_PROJECT_ID = 'bsm-client-app-web';
const LOCAL_EMULATOR_FIREBASE_PROJECT_ID = 'demo-bsm-console';
const USE_LOCAL_FIREBASE_EMULATORS = process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const expectedProjectId = USE_LOCAL_FIREBASE_EMULATORS
  ? LOCAL_EMULATOR_FIREBASE_PROJECT_ID
  : PRODUCTION_FIREBASE_PROJECT_ID;

if (USE_LOCAL_FIREBASE_EMULATORS && process.env.NODE_ENV === 'production') {
  throw new Error('Local Firebase emulator mode is not permitted in a production build.');
}

if (typeof window !== 'undefined' && firebaseConfig.projectId !== expectedProjectId) {
  throw new Error(`Firebase project mismatch. Expected: ${expectedProjectId}. Client: ${firebaseConfig.projectId || 'missing'}.`);
}

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const firebaseAuth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);

function localEmulatorHost() {
  const host = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST || '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('Local Firebase emulator host must be 127.0.0.1 or localhost.');
  }
  return host;
}

function localEmulatorPort(value: string | undefined, fallback: number, name: string) {
  if (value === undefined || value === '') return fallback;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a valid local TCP port.`);
  }
  return port;
}

/**
 * Local browser development deliberately uses the same demo project as the
 * trusted backend emulator guard. This is opt-in and cannot connect a
 * production-configured browser to an emulator by accident.
 */
if (typeof window !== 'undefined' && USE_LOCAL_FIREBASE_EMULATORS) {
  const emulatorState = globalThis as typeof globalThis & { __ventaleLocalFirebaseEmulatorsConnected?: boolean };
  if (!emulatorState.__ventaleLocalFirebaseEmulatorsConnected) {
    const host = localEmulatorHost();
    const authPort = localEmulatorPort(process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT, 9099, 'NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT');
    const firestorePort = localEmulatorPort(process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT, 8080, 'NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT');
    connectAuthEmulator(firebaseAuth, `http://${host}:${authPort}`, { disableWarnings: true });
    connectFirestoreEmulator(firestore, host, firestorePort);
    emulatorState.__ventaleLocalFirebaseEmulatorsConnected = true;
  }
}
