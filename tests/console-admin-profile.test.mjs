import assert from 'node:assert/strict';
import {test} from 'node:test';
import {consoleFixture} from './helpers/console-service-fixture.mjs';
import {reactFixture} from './helpers/react-fixture.mjs';

test('actual AuthProvider refreshes role/status and rejects stale profile callbacks after user change/unmount',()=>{
 const react=reactFixture();const listeners=[];let authCallback;let authStopped=false;
 const f=consoleFixture({overrides:{react:react.hooks,'./firebase':{firebaseAuth:{},firestore:{}},'firebase/auth':{GoogleAuthProvider:class{setCustomParameters(){}},onAuthStateChanged:(_auth,callback)=>{authCallback=callback;return()=>{authStopped=true;};},signInWithPopup:async()=>{},signOut:async()=>{}},'firebase/firestore':{doc:(_db,...segments)=>({path:segments.join('/')}),onSnapshot:(ref,next,error)=>{const listener={ref,next,error,stopped:false};listeners.push(listener);return()=>{listener.stopped=true;};}}}});
 const {AuthProvider}=f.load('lib/auth-context.tsx');const state=()=>react.render(AuthProvider,{children:null}).props.value;
 const emit=(listener,role,status)=>listener.next({exists:()=>true,data:()=>({role,status})});state();react.flush();authCallback({uid:'first',email:'first@example.test'});assert.equal(state().status,'loading');emit(listeners[0],'SUPER_ADMIN','ACTIVE');assert.equal(state().platformAdmin.role,'SUPER_ADMIN');
 emit(listeners[0],'SUPPORT','ACTIVE');assert.equal(state().platformAdmin.role,'SUPPORT');emit(listeners[0],'SUPPORT','DISABLED');assert.equal(state().status,'disabled');
 authCallback({uid:'second'});assert.equal(listeners[0].stopped,true);emit(listeners[0],'SUPER_ADMIN','ACTIVE');assert.equal(state().status,'loading');emit(listeners[1],'SUPPORT','ACTIVE');assert.equal(state().user.uid,'second');assert.equal(state().platformAdmin.role,'SUPPORT');
 listeners[1].error(new Error('Synthetic listener failure'));assert.equal(state().status,'error');assert.equal(state().platformAdmin,null);
 authCallback(null);assert.equal(listeners[1].stopped,true);emit(listeners[1],'SUPER_ADMIN','ACTIVE');assert.equal(state().status,'signed-out');assert.equal(state().platformAdmin,null);
 react.unmount();assert.equal(authStopped,true);authCallback({uid:'after-unmount'});assert.equal(listeners.at(-1).stopped,true);
});

function walk(element){if(!element||typeof element!=='object')return[];if(Array.isArray(element))return element.flatMap(walk);return[element,...walk(element.props?.children)];}
test('actual usage dialogs lose confirm/submit controls when an already-open SUPER_ADMIN view becomes SUPPORT',async()=>{
 const react=reactFixture();let mutations=0;
 const usage={usageAvailable:true,storageAvailable:false,usageCoverage:'PARTIAL',usageNotes:['Partial synthetic estimate'],storageBytes:0,firestoreBytesEstimated:10,totalBytesEstimated:10,fileCount:0,recordCount:1,breakdown:{files:0},storageLimitBytes:null,usagePercent:null,usageStatus:'UNAVAILABLE'};
 const f=consoleFixture({overrides:{react:react.hooks,'lucide-react':{Database:'Icon',File:'Icon',HardDrive:'Icon',RefreshCw:'Icon',Settings2:'Icon'},'@/lib/console-api':{getOrganizationUsage:async()=>usage,recalculateOrganizationUsage:async()=>{mutations++;return usage;},setOrganizationStorageLimit:async()=>{mutations++;return usage;}},'./ConsolePrimitives':{CompactBadge:'CompactBadge',CompactIconButton:'CompactIconButton',ConfirmActionDialog:'ConfirmActionDialog',ErrorState:'ErrorState',formatDate:()=> 'Synthetic date'}}});
 const {OrganizationUsageSection}=f.load('components/console/OrganizationUsageSection.tsx');const render=superAdmin=>react.render(OrganizationUsageSection,{orgId:'org',isSuperAdmin:superAdmin});render(true);react.flush();await new Promise(resolve=>setImmediate(resolve));
 let elements=walk(render(true));const recalculate=elements.find(row=>row.type==='button'&&walk(row).some(child=>child.props?.children?.includes('Recalculate Usage')));assert.ok(recalculate);recalculate.props.onClick();elements=walk(render(true));assert.ok(elements.some(row=>row.type==='ConfirmActionDialog'));
 assert.equal(walk(render(false)).some(row=>row.type==='ConfirmActionDialog'),false);assert.equal(mutations,0);
 elements=walk(render(true));elements.find(row=>row.type==='ConfirmActionDialog').props.onCancel();elements=walk(render(true));elements.find(row=>row.type==='CompactIconButton'&&row.props.label==='Set storage limit').props.onClick();assert.ok(walk(render(true)).some(row=>row.props?.role==='dialog'));
 assert.equal(walk(render(false)).some(row=>row.props?.role==='dialog'),false);assert.equal(mutations,0);react.unmount();
});
