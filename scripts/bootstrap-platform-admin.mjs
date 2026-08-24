import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const uid = process.env.BSM_BOOTSTRAP_ADMIN_UID;
const email = process.env.BSM_BOOTSTRAP_ADMIN_EMAIL;
const expectedProjectId = process.env.BSM_EXPECTED_PROJECT_ID || 'bsm-client-app-web';
const configuredProjectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (configuredProjectId && configuredProjectId !== expectedProjectId) throw new Error(`Firebase project mismatch. Expected ${expectedProjectId}; configured ${configuredProjectId}.`);
if (!uid || !email) throw new Error('Set BSM_BOOTSTRAP_ADMIN_UID and BSM_BOOTSTRAP_ADMIN_EMAIL explicitly.');
if (!getApps().length) initializeApp(process.env.FIREBASE_ADMIN_CLIENT_EMAIL && process.env.FIREBASE_ADMIN_PRIVATE_KEY ? { credential: cert({ projectId: process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n') }) } : { credential: applicationDefault(), projectId: process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID });
const authUser = await getAuth().getUser(uid);
if (!authUser.email || authUser.email.toLowerCase() !== email.toLowerCase()) throw new Error('The supplied UID and email do not match Firebase Authentication.');
const db = getFirestore();
const ref = db.collection('platformAdmins').doc(uid);
if ((await ref.get()).exists) throw new Error(`platformAdmins/${uid} already exists; refusing to overwrite it.`);
await ref.set({ email: authUser.email, displayName: authUser.displayName || '', role: 'SUPER_ADMIN', status: 'ACTIVE', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), createdBy: 'bootstrap', updatedBy: 'bootstrap' });
console.log(`Created platformAdmins/${uid} as SUPER_ADMIN.`, 'No production deployment was performed.');
