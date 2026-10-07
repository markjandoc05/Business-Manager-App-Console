import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {resolveFirebaseProjectIdentity} from '../lib/server/firebase-project.ts';

const identity=resolveFirebaseProjectIdentity();
const host=process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(identity.mode!=='emulator'||identity.projectId!=='demo-bsm-console'||![host,process.env.FIRESTORE_EMULATOR_HOST].every(value=>/^(127\.0\.0\.1|localhost):\d+$/.test(value||'')))throw new Error('Only isolated demo project and loopback Auth/Firestore emulators are allowed.');
const {adminDb,adminAuth}=await import('../lib/server/firebase-admin-core.ts');
const {handleLicenseMutation}=await import('../lib/server/license-handler.ts');

// Auth emulator checks revocation even without checkRevoked=true. The synthetic
// shared-helper regression is required to distinguish production before/after.
test('native revoked and disabled Auth identities cannot mutate license/root/audit despite ACTIVE admin records',async()=>{
 for(const mode of ['revoked','disabled']){
  const suffix=randomUUID();const orgId=`security-${suffix}`;const org=adminDb.collection('organizations').doc(orgId);let uid;
  try{
   const response=await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${mode}-${suffix}@example.test`,password:'synthetic-password-123',returnSecureToken:true})});
   assert.equal(response.status,200);const credentials=await response.json();uid=credentials.localId;
   await adminDb.collection('platformAdmins').doc(uid).set({status:'ACTIVE',role:'SUPER_ADMIN'});
   await org.set({status:'trial',licenseStatus:'TRIAL',licenseWriteEnabled:true,name:'Synthetic'});
   await org.collection('license').doc('current').set({plan:'TRIAL',status:'TRIAL',maxUsers:3,trialStartedAt:new Date(Date.now()-1000),trialEndsAt:new Date(Date.now()+86400000),features:{crm:true}});
   const beforeRoot=(await org.get()).data();const beforeLicense=(await org.collection('license').doc('current').get()).data();
   if(mode==='disabled')await adminAuth.updateUser(uid,{disabled:true});else{await new Promise(resolve=>setTimeout(resolve,1100));await adminAuth.revokeRefreshTokens(uid);}
   let parsed=false;await assert.rejects(()=>handleLicenseMutation(credentials.idToken,orgId,'suspend',async()=>{parsed=true;return{};}),error=>error.status===401&&error.code==='UNAUTHENTICATED');assert.equal(parsed,false);
   assert.deepEqual((await org.get()).data(),beforeRoot);assert.deepEqual((await org.collection('license').doc('current').get()).data(),beforeLicense);assert.equal((await adminDb.collection('platformAuditLogs').where('organizationId','==',orgId).get()).size,0);
  }finally{await adminDb.recursiveDelete(org);if(uid){await adminDb.collection('platformAdmins').doc(uid).delete();await adminAuth.deleteUser(uid);}}
 }
});
