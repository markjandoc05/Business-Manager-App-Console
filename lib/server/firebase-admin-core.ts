import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { assertFirebaseProject } from './firebase-project';

export { assertFirebaseProject } from './firebase-project';

let adminApp = getApps()[0];
let adminAuthInstance: ReturnType<typeof getAuth> | undefined;
let adminDbInstance: ReturnType<typeof getFirestore> | undefined;

function getAdminApp() {
  const identity = assertFirebaseProject();
  adminApp ??= initializeApp({ credential: applicationDefault(), projectId: identity.projectId });
  return adminApp;
}

function getAdminAuth() {
  adminAuthInstance ??= getAuth(getAdminApp());
  return adminAuthInstance;
}

function getAdminDb() {
  adminDbInstance ??= getFirestore(getAdminApp());
  return adminDbInstance;
}

export const adminAuth = new Proxy({} as ReturnType<typeof getAuth>, {
  get(_target, property) {
    const value = getAdminAuth()[property as keyof ReturnType<typeof getAuth>];
    return typeof value === 'function' ? value.bind(getAdminAuth()) : value;
  },
});

export const adminDb = new Proxy({} as ReturnType<typeof getFirestore>, {
  get(_target, property) {
    const value = getAdminDb()[property as keyof ReturnType<typeof getFirestore>];
    return typeof value === 'function' ? value.bind(getAdminDb()) : value;
  },
});
