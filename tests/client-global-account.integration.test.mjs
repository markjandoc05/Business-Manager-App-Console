import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';
const identity = resolveFirebaseProjectIdentity();
if (identity.mode !== 'emulator' || identity.projectId !== 'demo-bsm-console' || !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) throw new Error('Local demo emulators required');
const {adminDb} = await import('../lib/server/firebase-admin-core.ts');
const {DEFAULT_SUBSCRIPTION_PLANS} = await import('../lib/subscription-plan-contract.ts');
const {provisionClientPlatformTrial, getClientPlatformSubscription} = await import('../lib/server/client-platform-api-handler.ts');
const {provisionSubscriptionTrial} = await import('../lib/server/subscription-license-service.ts');
const {requireAuthenticatedClientToken} = await import('../lib/server/client-organization-auth.ts');
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
async function user(label) {
 const r=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${label}-${suffix}@example.test`,password:'Synthetic-local-test-123',returnSecureToken:true})});assert.equal(r.status,200);return r.json();
}
const denied = (e) => e.code === 'UNAUTHORIZED' && e.status === 403;
test('new Auth account can provision, but every existing global profile must be strictly active',async()=>{
 await Promise.all(Object.entries(DEFAULT_SUBSCRIPTION_PLANS).map(([id,data])=>adminDb.doc(`platformPlans/${id}`).set(data)));
 await adminDb.doc('platformPlanUsage/founding_100').set({eligibleCustomerCount:0});
 const owner=await user('global-guard-owner');
 const body={productCode:'founding_100',workspace:{businessName:'Guard test',requestedSlug:`guard-${suffix}`,businessType:'Agency',currency:'USD',timezone:'Asia/Manila'}};
 await adminDb.doc(`users/${owner.localId}`).set({uid:owner.localId,status:'pending',active:false});
 const key=`guard-replay-${suffix}`;
 const result=await provisionClientPlatformTrial(owner.idToken,body,key);
 assert.ok(result.organizationId);
 assert.equal((await getClientPlatformSubscription(owner.idToken,result.organizationId)).organizationId,result.organizationId);
 const profile=adminDb.doc(`users/${owner.localId}`),active=(await profile.get()).data();
 for(const override of [{status:'inactive'},{status:'pending',active:false},{status:'ACTIVE'},{active:false},{uid:'mismatched-uid'}]){
  await profile.set({...active,...override});
  await assert.rejects(getClientPlatformSubscription(owner.idToken,result.organizationId),denied);
  await assert.rejects(provisionClientPlatformTrial(owner.idToken,body,key),denied);
 }
 await profile.delete();
 await assert.rejects(getClientPlatformSubscription(owner.idToken,result.organizationId),denied);
 await assert.rejects(provisionClientPlatformTrial(owner.idToken,body,key),denied);
 await assert.rejects(provisionClientPlatformTrial(owner.idToken,body,`${key}-new`),denied);
 await profile.set({...active,status:'inactive'});
 // Exercise the transaction after a hypothetical token-time authorization check.
 await assert.rejects(provisionSubscriptionTrial('founding_100',{uid:owner.localId,email:owner.email,displayName:'Guard'}, {name:'Cannot revive',requestedSlug:`revive-${suffix}`,businessType:'Agency',currency:'USD',timezone:'Asia/Manila'}),denied);
 assert.equal((await profile.get()).data().status,'inactive');
 assert.equal((await adminDb.doc('platformPlanUsage/founding_100').get()).data().eligibleCustomerCount,1);
 await profile.set(active);
 const previouslyAuthorized=await requireAuthenticatedClientToken(owner.idToken);
 await profile.update({status:'inactive'});
 await assert.rejects(provisionSubscriptionTrial('founding_100',previouslyAuthorized,{name:'Race denied',requestedSlug:`race-${suffix}`,businessType:'Agency',currency:'USD',timezone:'Asia/Manila'}),denied);
 await profile.set(active);
 assert.equal((await provisionClientPlatformTrial(owner.idToken,body,key)).idempotent,true);
 const member=adminDb.doc(`organizations/${result.organizationId}/members/${owner.localId}`),original=(await member.get()).data();
 const counterBefore=(await adminDb.doc('platformPlanUsage/founding_100').get()).data();
 for(const override of [{status:'suspended'},{status:'archived'},{role:'USER'},{status:'ACTIVE'}]){
  await member.set({...original,...override});
  await assert.rejects(provisionClientPlatformTrial(owner.idToken,body,key),e=>e.code==='FORBIDDEN'&&e.status===403);
  assert.deepEqual((await adminDb.doc('platformPlanUsage/founding_100').get()).data(),counterBefore);
 }
 await member.delete();
 await assert.rejects(provisionClientPlatformTrial(owner.idToken,body,key),e=>e.code==='FORBIDDEN'&&e.status===403);
 await member.set(original);
 await adminDb.doc(`organizations/${result.organizationId}`).delete();
 await assert.rejects(provisionClientPlatformTrial(owner.idToken,body,key),e=>e.code==='FORBIDDEN'&&e.status===403);
});

test('legacy prepared-workspace onboarding accepts a fresh canonical pending profile and rejects malformed pending profiles',async()=>{
 const {handleClientSubscriptionTrial}=await import('../lib/server/client-subscription-handler.ts');
 const pending=await user('legacy-pending');
 await adminDb.doc(`users/${pending.localId}`).set({uid:pending.localId,status:'pending',active:false});
 const workspace={name:'Legacy pending',requestedSlug:`legacy-pending-${suffix}`,businessType:'Agency',currency:'USD',timezone:'Asia/Manila'};
 const result=await handleClientSubscriptionTrial(pending.idToken,{planId:'founding_100',workspace});
 assert.ok(result.organizationId);
 assert.equal((await adminDb.doc(`users/${pending.localId}`).get()).data().status,'active');
 for(const [index,override] of [{uid:'wrong-uid'},{active:true},{status:'PENDING'}].entries()){
  const blocked=await user(`malformed-pending-${index}`);
  const profile={uid:blocked.localId,status:'pending',active:false,...override};
  await adminDb.doc(`users/${blocked.localId}`).set(profile);
  await assert.rejects(handleClientSubscriptionTrial(blocked.idToken,{planId:'founding_100',workspace:{...workspace,requestedSlug:`bad-pending-${index}-${suffix}`}}),denied);
  assert.deepEqual((await adminDb.doc(`users/${blocked.localId}`).get()).data(),profile);
 }
});
