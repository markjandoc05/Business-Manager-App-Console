import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {Timestamp, FieldValue} from 'firebase-admin/firestore';
import {NextResponse} from 'next/server.js';

// Execute repository code with synthetic SDK adapters. Transactions serialize;
// this is not native Firestore isolation, rules or Auth backend verification.
export function consoleFixture({environment={}, overrides={}, globals={}}={}) {
  const records=new Map(); const reads=[]; const authCalls=[]; const storageFiles=[];
  const materialize=value=>value instanceof FieldValue ? Timestamp.now() : value instanceof Timestamp || value instanceof Date ? value : Array.isArray(value) ? value.map(materialize) : value && typeof value==='object' ? Object.fromEntries(Object.entries(value).map(([key,item])=>[key,materialize(item)])) : value;
  let serial=0; let tail=Promise.resolve(); let beforeTransaction; let beforeStorage;
  const snapshot=p=>({id:p.split('/').at(-1),ref:doc(p),exists:records.has(p),data:()=>records.has(p)?{...records.get(p)}:undefined});
  const doc=p=>({path:p,id:p.split('/').at(-1),collection:name=>collection(`${p}/${name}`),get:async()=>{reads.push(p);return snapshot(p);}});
  const field=(item,name)=>name==='__name__'?item.id:item.data()[name];
  const scalar=value=>value?.toMillis?value.toMillis():value;
  const query=(p,filters=[],orders=[],maximum=Infinity,cursor)=>({path:p,filters,orders,maximum,cursor,
    doc:id=>doc(`${p}/${id||`generated-${++serial}`}`),where:(name,operator,value)=>{assert.equal(operator,'==');return query(p,[...filters,[name,value]],orders,maximum,cursor);},
    orderBy:(name,direction='asc')=>query(p,filters,[...orders,[name,direction]],maximum,cursor),
    limit:count=>query(p,filters,orders,count,cursor),startAfter:row=>query(p,filters,orders,maximum,row),
    get:async()=>{reads.push({path:p,filters,orders,maximum,cursor:cursor?.id});return querySnapshot({path:p,filters,orders,maximum,cursor});},
    count:()=>({get:async()=>({data:()=>({count:querySnapshot({path:p,filters,orders,maximum,cursor}).size})})}),
  });
  const collection=p=>query(p);
  const querySnapshot=ref=>{
    let docs=[...records.keys()].filter(p=>p.startsWith(`${ref.path}/`)&&!p.slice(ref.path.length+1).includes('/')).map(snapshot);
    docs=docs.filter(row=>(ref.filters||[]).every(([name,value])=>field(row,name)===value)&&(ref.orders||[]).every(([name])=>field(row,name)!==undefined));
    docs.sort((a,b)=>{for(const [name,direction] of ref.orders||[]){const av=scalar(field(a,name));const bv=scalar(field(b,name));if(av!==bv)return(av<bv?-1:1)*(direction==='desc'?-1:1);}return a.id.localeCompare(b.id)*((ref.orders||[]).at(-1)?.[1]==='desc'?-1:1);});
    if(ref.cursor){const at=docs.findIndex(row=>row.id===ref.cursor.id);assert.notEqual(at,-1,'Fixture cursor must belong to query');docs=docs.slice(at+1);}
    docs=docs.slice(0,ref.maximum??Infinity);return{docs,size:docs.length,empty:!docs.length};
  };
  const db={doc,collection,runTransaction:callback=>{
    const run=async()=>{if(beforeTransaction){const hook=beforeTransaction;beforeTransaction=undefined;await hook();}let writing=false;const writes=[];
      const transaction={get:async ref=>{assert.equal(writing,false,'Read after transaction write');reads.push(ref.path);return ref.filters?querySnapshot(ref):snapshot(ref.path);},set:(ref,data,options)=>{writing=true;writes.push(()=>records.set(ref.path,materialize(options?.merge?{...records.get(ref.path),...data}:data)));}};
      const result=await callback(transaction);writes.forEach(write=>write());return result;};
    const pending=tail.then(run,run);tail=pending.catch(()=>{});return pending;
  }};
  const auth={verifyIdToken:async(token,checkRevoked)=>{authCalls.push([token,checkRevoked]);if(token==='invalid'||(checkRevoked&&['revoked','disabled-auth','deleted-auth'].includes(token)))throw new Error('Synthetic invalid identity');return{uid:token,email:`${token}@example.test`,name:token};}};
  const dependencies={'firebase-admin/firestore':{Timestamp,FieldValue,FieldPath:{documentId:()=>'__name__'}},'firebase-admin/storage':{getStorage:()=>({bucket:()=>({getFiles:async()=>{if(beforeStorage)await beforeStorage();return[storageFiles];}})})},
    './firebase-admin-core':{adminDb:db,adminAuth:auth,assertFirebaseProject:()=>{}},'./firebase-admin-core.ts':{adminDb:db,adminAuth:auth,assertFirebaseProject:()=>{}},'@/lib/server/firebase-admin-core':{adminDb:db,adminAuth:auth,assertFirebaseProject:()=>{}},'next/server':{NextResponse},...overrides};
  const cache=new Map();
  function load(filename){filename=path.resolve(filename);if(cache.has(filename))return cache.get(filename).exports;
    const fixtureModule={exports:{}};cache.set(filename,fixtureModule);let source=fs.readFileSync(filename,'utf8');
    if(process.env.VENTALE_CONSOLE_BASELINE){assert.match(process.env.VENTALE_CONSOLE_BASELINE,/^[a-f0-9]{7,40}$/);source=execFileSync('git',['show',`${process.env.VENTALE_CONSOLE_BASELINE}:${path.relative(process.cwd(),filename)}`],{encoding:'utf8'});}
    const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
    const require=name=>{if(Object.hasOwn(dependencies,name))return dependencies[name];assert.ok(name.startsWith('.')||name.startsWith('@/'),`Unexpected dependency ${name}`);const target=name.startsWith('@/')?path.resolve(name.slice(2)):path.resolve(path.dirname(filename),name);return load([target,`${target}.ts`,`${target}.tsx`].find(fs.existsSync));};
    vm.runInNewContext(compiled,{module:fixtureModule,exports:fixtureModule.exports,require,Date,console,Error,Promise,Number,String,Object,Set,Map,Math,Buffer,Headers,Response,URL,URLSearchParams,TextEncoder,process:{env:environment},...globals}, {filename});return fixtureModule.exports;
  }
  const actor={uid:'super',email:'super@example.test',displayName:'Synthetic Super',role:'SUPER_ADMIN'};
  records.set('platformAdmins/super',{role:'SUPER_ADMIN',status:'ACTIVE'});
  return{records,reads,authCalls,storageFiles,db,actor,load,beforeTransaction:fn=>{beforeTransaction=fn;},beforeStorage:fn=>{beforeStorage=fn;}};
}
