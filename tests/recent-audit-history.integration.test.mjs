import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFirebaseProjectIdentity } from '../lib/server/firebase-project.ts';
const identity=resolveFirebaseProjectIdentity();
if(identity.mode!=='emulator'||identity.projectId!=='demo-bsm-console')throw new Error('Demo emulators required');
const {adminDb}=await import('../lib/server/firebase-admin-core.ts');
const {getOrganizationOperationsDetail}=await import('../lib/server/organization-operations-service.ts');
const {getSubscriptionLicenseDetail}=await import('../lib/server/subscription-operations-service.ts');
test('both detail views include the newest safe event beyond fifty older lexically earlier IDs',async()=>{
 const orgId=`recent-history-${Date.now()}`,org=adminDb.doc(`organizations/${orgId}`),now=Date.now();
 await org.set({name:'Recent history fixture',status:'active'});
 await org.collection('license').doc('current').set({plan:'TEAM',status:'ACTIVE',maxUsers:3,subscriptionStartedAt:new Date(now-60000),subscriptionEndsAt:new Date(now+86400000),features:{crm:true}});
 await Promise.all(Array.from({length:65},(_,i)=>adminDb.doc(`platformAuditLogs/a-old-${orgId}-${i}`).set({organizationId:orgId,action:'ORGANIZATION_LICENSE_RENEWED',actorRole:'SUPER_ADMIN',createdAt:new Date(now-100000-i)})));
 const latestId=`z-newest-${orgId}`;
 await adminDb.doc(`platformAuditLogs/${latestId}`).set({organizationId:orgId,action:'ORGANIZATION_LICENSE_REACTIVATED',actorRole:'SUPER_ADMIN',createdAt:new Date(now),actorEmail:'must-not-return@example.test',newValue:{secret:'must-not-return'}});
 for(const detail of await Promise.all([getOrganizationOperationsDetail(orgId),getSubscriptionLicenseDetail(orgId)])){
  assert.equal(detail.auditHistory[0].id,latestId);
  assert.doesNotMatch(JSON.stringify(detail.auditHistory),/must-not-return/);
 }
});
