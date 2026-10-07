import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Timestamp} from 'firebase-admin/firestore';
import {consoleFixture} from './helpers/console-service-fixture.mjs';
const future=()=>Timestamp.fromMillis(Date.now()+86400000*30);
function seed(f,status='TRIAL',plan='TRIAL'){
 const p='organizations/org';f.records.set(p,{name:'Synthetic',status:'trial',unchanged:'history'});
 f.records.set(`${p}/license/current`,{plan,status,maxUsers:3,features:{crm:true},trialStartedAt:Timestamp.fromMillis(Date.now()-1000),trialEndsAt:future(),subscriptionStartedAt:Timestamp.fromMillis(Date.now()-1000),subscriptionEndsAt:future()});
 return p;
}
test('actual shared auth boundary rejects revoked/disabled/deleted identities before record reads or license parsing',async()=>{
 for(const token of ['revoked','disabled-auth','deleted-auth','invalid']){
  const f=consoleFixture();seed(f);f.records.set(`platformAdmins/${token}`,{status:'ACTIVE',role:'SUPER_ADMIN'});let parsed=false;
  const handler=f.load('lib/server/license-handler.ts');await assert.rejects(()=>handler.handleLicenseMutation(token,'org','suspend',async()=>{parsed=true;return{};}),error=>error.code==='UNAUTHENTICATED'&&error.status===401);
  assert.equal(parsed,false);assert.equal(f.reads.length,0);assert.deepEqual(f.authCalls,[[token,true]]);
 }
});
test('actual auth keeps enabled platform roles, disabled document errors and tenant denials',async()=>{
 const f=consoleFixture();const service=f.load('lib/server/platform-admin.ts');
 assert.equal((await service.requirePlatformAdminToken('super')).role,'SUPER_ADMIN');
 f.records.set('platformAdmins/support',{role:'SUPPORT',status:'ACTIVE'});assert.equal((await service.requirePlatformAdminToken('support')).role,'SUPPORT');
 await assert.rejects(()=>service.requirePlatformAdminToken('support',['SUPER_ADMIN']),e=>e.status===403);
 await assert.rejects(()=>service.requirePlatformAdminToken('tenant'),e=>e.status===403);
 f.records.set('platformAdmins/disabled-document',{role:'SUPER_ADMIN',status:'DISABLED'});await assert.rejects(()=>service.requirePlatformAdminToken('disabled-document'),e=>e.code==='ADMIN_DISABLED'&&e.status===403);
 await assert.rejects(()=>service.requirePlatformAdminToken(''),e=>e.status===401);
});
test('actual paid conversion and suspend/reactivate/expire/renew synchronize existing root lifecycle atomically',async()=>{
 const f=consoleFixture();const p=seed(f);const service=f.load('lib/server/license-service.ts');const body={plan:'TEAM',maxUsers:3,subscriptionStartedAt:new Date(Date.now()-1000).toISOString(),subscriptionEndsAt:future().toDate().toISOString()};
 await service.mutateLicense('org','convert-to-paid',body,f.actor);assert.equal(f.records.get(p).status,'active');assert.equal(f.records.get(p).licenseStatus,'ACTIVE');assert.equal(f.records.get(p).unchanged,'history');
 for(const [action,expected] of [['suspend','suspended'],['reactivate','active'],['expire','expired'],['renew','active']]){await service.mutateLicense('org',action,action==='renew'?body:{},f.actor);assert.equal(f.records.get(p).status,expected);assert.equal(f.records.get(p).licenseWriteEnabled,expected==='active');}
 assert.equal([...f.records.keys()].filter(k=>k.startsWith('platformAuditLogs/')).length,5);
});
test('license drift reports root lifecycle; expired trials remain unable to convert and unknown root states fail closed',async()=>{
 const f=consoleFixture();const p=seed(f);const contract=f.load('lib/license-contract.ts');const license=f.records.get(`${p}/license/current`);const mirror=contract.buildOrganizationLicenseMirror(license);
 assert.ok(contract.compareOrganizationLicenseMirror(license,{...mirror,status:'active'}).differences.some(item=>item.field==='status'));
 const service=f.load('lib/server/license-service.ts');f.records.set(`${p}/license/current`,{...license,trialEndsAt:Timestamp.fromMillis(Date.now()-1)});
 await assert.rejects(()=>service.mutateLicense('org','convert-to-paid',{},f.actor),e=>e.status===409);
 f.records.set(`${p}/license/current`,license);f.records.set(p,{status:'archived'});await assert.rejects(()=>service.mutateLicense('org','suspend',{},f.actor),e=>e.status===409);assert.equal(f.records.get(p).status,'archived');
});
test('usage reconciliation preserves a changed or cleared limit through the actual setter, returned/stored data and its audit',async()=>{
 for(const limit of [200,null]){
  const f=consoleFixture({environment:{FIREBASE_STORAGE_BUCKET:'synthetic-bucket'}});f.records.set('organizations/org',{name:'Synthetic'});f.records.set('organizations/org/usage/current',{storageLimitBytes:100,retained:'metadata'});f.storageFiles.push({metadata:{size:'20'}});
  const service=f.load('lib/server/organization-usage-service.ts');f.beforeStorage(()=>service.setOrganizationStorageLimit('org',limit,f.actor));const result=await service.recalculateOrganizationUsage('org',f.actor);
  assert.equal(result.storageLimitBytes,limit);assert.equal(result.usagePercent,limit===null?null:10);assert.equal(f.records.get('organizations/org/usage/current').storageLimitBytes,limit);assert.equal(f.records.get('organizations/org/usage/current').retained,'metadata');
  const audit=[...f.records].find(([key,value])=>key.startsWith('platformAuditLogs/')&&value.action==='ORGANIZATION_USAGE_RECALCULATED')[1];assert.equal(audit.newValue.storageLimitBytes,limit);
 }
});
test('missing/legacy storage measurements remain unavailable and database coverage stays explicitly partial',async()=>{
 const f=consoleFixture();f.records.set('organizations/org',{name:'Synthetic'});f.records.set('organizations/org/sales/sale',{totalAmount:10});
 const service=f.load('lib/server/organization-usage-service.ts');const result=await service.recalculateOrganizationUsage('org',f.actor);
 assert.equal(result.storageAvailable,false);assert.equal(result.usagePercent,null);assert.equal(result.usageStatus,'UNAVAILABLE');assert.equal(result.usageCoverage,'PARTIAL');assert.ok(result.usageNotes.join(' ').includes('Sales'));
 const legacy=service.storedUsage({lastCalculatedAt:new Date().toISOString(),storageBytes:0,firestoreBytesEstimated:1,totalBytesEstimated:1});assert.equal(legacy.storageAvailable,false);assert.equal(legacy.usageCoverage,'UNKNOWN');assert.equal(legacy.usageStatus,'UNAVAILABLE');
 const invalid=service.storedUsage({lastCalculatedAt:null,firestoreBytesEstimated:NaN,totalBytesEstimated:-1});assert.equal(invalid.usageAvailable,false);
});
test('organization-filtered audit pages reach matching old events despite newer unrelated events and validate cursors',async()=>{
 const f=consoleFixture();for(let i=0;i<130;i++)f.records.set(`platformAuditLogs/event-${String(i).padStart(3,'0')}`,{organizationId:i<30?'org':'other',createdAt:Timestamp.fromMillis(i+1),action:'SYNTHETIC'});
 const service=f.load('lib/server/console-read-service.ts');const first=await service.listConsoleAuditLogs(25,undefined,'org');assert.equal(first.items.length,25);assert.ok(first.items.every(row=>row.organizationId==='org'));assert.equal(first.items[0].id,'event-029');
 const second=await service.listConsoleAuditLogs(25,first.nextCursor,'org');assert.equal(second.items.length,5);assert.equal(second.nextCursor,undefined);
 await assert.rejects(()=>service.listConsoleAuditLogs(25,'event-129','org'),e=>e.status===400);
 await assert.rejects(()=>service.listConsoleAuditLogs(25,'missing','org'),e=>e.status===409);
 await assert.rejects(()=>service.listConsoleAuditLogs(25,undefined,'../org'),e=>e.status===400);
});
test('bounded query pages retain every organization/member and dashboard totals without truncating existing lists',async()=>{
 const f=consoleFixture();for(let i=0;i<111;i++){const p=`organizations/org-${String(i).padStart(3,'0')}`;f.records.set(p,{name:p,status:'active'});f.records.set(`${p}/members/member`,{userId:'member',role:'ADMIN',status:'active'});}
 for(let i=0;i<220;i++)f.records.set(`organizations/org-000/members/extra-${String(i).padStart(3,'0')}`,{userId:`extra-${i}`,role:'USER',status:'active'});
 const reads=f.load('lib/server/console-read-service.ts');assert.equal((await reads.listConsoleOrganizations()).length,111);assert.equal((await reads.listConsoleMemberships()).length,331);assert.equal((await reads.getConsoleOrganization('org-000')).members.length,221);
 const dashboard=f.load('lib/server/dashboard-service.ts');const metrics=await dashboard.getDashboardMetrics();assert.equal(metrics.summary.organizationsTotal,111);assert.equal(metrics.summary.activeMembers,331);
 const listQueries=f.reads.filter(row=>typeof row==='object'&&(/organizations$|\/members$/.test(row.path)));assert.ok(listQueries.length>0);assert.ok(listQueries.every(row=>row.maximum===100));
});
test('bounded Console mapping preserves order and at most five active row readers',async()=>{
 const f=consoleFixture();const {mapConsoleReads}=f.load('lib/server/bounded-console-reads.ts');let active=0;let peak=0;
 const result=await mapConsoleReads(Array.from({length:21},(_,i)=>i),async item=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>queueMicrotask(resolve));active--;return item*2;});assert.equal(peak,5);assert.deepEqual(Array.from(result),Array.from({length:21},(_,i)=>i*2));
});
test('unavailable file metadata and storage failures preserve prior usage and emit no reconciliation audit',async()=>{
 for(const failure of ['metadata','provider','blank','boolean','fraction','negative','oversize']){
  const f=consoleFixture({environment:{FIREBASE_STORAGE_BUCKET:'synthetic-bucket'}});f.records.set('organizations/org',{name:'Synthetic'});const old={storageLimitBytes:500,lastCalculatedAt:Timestamp.now(),storageBytes:100,firestoreBytesEstimated:10,totalBytesEstimated:110,storageAvailable:true,usageCoverage:'PARTIAL'};f.records.set('organizations/org/usage/current',old);
  if(failure==='provider')f.beforeStorage(()=>{throw new Error('Synthetic Storage unavailable');});else f.storageFiles.push({metadata:{size:{metadata:undefined,blank:'',boolean:true,fraction:'1.5',negative:'-2',oversize:'9007199254740992'}[failure]}});
  const service=f.load('lib/server/organization-usage-service.ts');await assert.rejects(()=>service.recalculateOrganizationUsage('org',f.actor));assert.equal(f.records.get('organizations/org/usage/current'),old);assert.equal([...f.records.keys()].filter(key=>key.startsWith('platformAuditLogs/')).length,0);
 }
});
test('actual audit API and browser request preserve organization filter and unchanged read roles',async()=>{
 let route;let requestedPath;const auth={currentUser:{uid:'support'}};
 const f=consoleFixture({overrides:{'./firebase':{firebaseAuth:auth},'firebase/auth':{getIdToken:async user=>user.uid,signOut:async()=>{}}},globals:{fetch:async(path,options)=>{requestedPath=path;return route.GET({url:`http://localhost${path}`,headers:new Headers(options.headers)});}}});
 f.records.set('platformAdmins/support',{status:'ACTIVE',role:'SUPPORT'});
 route=f.load('app/api/audit-logs/route.ts');f.records.set('platformAuditLogs/old',{organizationId:'org',createdAt:Timestamp.fromMillis(1)});f.records.set('platformAuditLogs/new',{organizationId:'other',createdAt:Timestamp.fromMillis(2)});
 const api=f.load('lib/console-api.ts');const result=await api.getAuditLogs(25,undefined,'org');assert.equal(result.items.length,1);assert.equal(result.items[0].organizationId,'org');assert.ok(requestedPath.includes('organizationId=org'));
});
