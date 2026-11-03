// Private alias store over real SQLite and real auth/profile/runtime modules; no HTTP/provider/key files.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {PersonalLegacy} from '../worker/core/personal-legacy.ts';
import {Trust} from '../worker/core/trust.ts';
import {ConnectedHost} from '../worker/core/connected.ts';
import {PersonalAdoption} from '../worker/core/personal-adoption.ts';
import {PersonalAuthStore,personalDigest,personalNonce} from '../worker/core/personal-session.ts';
import {PersonalRegistration} from '../worker/core/personal-registration.ts';
import {LegacyProfile} from '../worker/core/legacy-profile.ts';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
import {Ledger} from '../worker/core/ledger.ts';
import {makeHooks} from '../src/engine/rules.ts';
import {generateKeyPair} from '../src/identity/jws.ts';
import {canonicalize} from '../src/identity/jcs.ts';
const code=c=>e=>e?.code===c;
async function boot(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let depth=0,clock=1_000_000,hook=()=>{},reads=0,commits=0;
 const storage={sql:{exec(q,...b){const st=db.prepare(q),r=st.columns().length?st.all(...b):(st.run(...b),[]);return{toArray:()=>r};}},transactionSync(fn){const n='sp'+depth++;db.exec('SAVEPOINT '+n);try{const v=fn();assert.ok(!v?.then);db.exec('RELEASE '+n);return v;}catch(e){db.exec('ROLLBACK TO '+n);db.exec('RELEASE '+n);throw e;}finally{depth--;}}};
 const auth=new PersonalAuthStore(storage);auth.init();const registration=new PersonalRegistration(storage,auth,{now:()=>clock});registration.init();
 const ledger=new Ledger(storage.sql,{dailyCapUsd:1});ledger.init();const runtime=new WorldRuntime({...storage.sql,transactionSync:storage.transactionSync},{worldId:'synthetic-adoption',ledger,hooks:makeHooks(),model:null});runtime.init(clock);
 const legacy=new LegacyProfile(storage,runtime,()=>clock);legacy.init();let root=await generateKeyPair(true),worldId='synthetic-adoption',commitEdit=x=>x;
 const trust=new Trust(storage.sql);trust.init();const ownerRoot=await crypto.subtle.exportKey('jwk',root.privateKey);await trust.ensureAgents(ownerRoot);const connected=new ConnectedHost({sql:storage.sql,trust,runtime,hooks:makeHooks(),baseUrl:'https://fixture.invalid',ownerRoot:()=>ownerRoot,ownerClaimed:()=>true,now:()=>clock});connected.init();const key=await connected.keys.issue('00-jolly',clock);connected.keys.touch(key.row.id,clock);
 const current=()=>{reads++;const {kty,crv,x,y}=root.publicJwk;return{actorId:'00-jolly',agentId:root.kid,rootBinding:canonicalize({kty,crv,x,y}),worldId,profile:legacy.get({principal:'owner',ownerId:'owner:kim-sejun',exp:clock+1})};};
 const options={now:()=>clock,currentLegacy:current,commitProfile:(owner,input)=>{commits++;const p=legacy.patch(owner,input),e=runtime.events().filter(x=>x.kind==='legacy_profile_updated').at(-1),record=db.prepare('SELECT after_hash FROM run_inputs WHERE seq=? AND run_id=?').get(e.inputSeq,e.runId);hook();return{profile:p,commit:commitEdit({worldId,runId:e.runId,inputSeq:e.inputSeq,eventSeq:e.seq,eventId:e.id,afterHash:record.after_hash})};}};
 let service=new PersonalAdoption(storage,auth,options);service.init();
 const binding=async(subject='42',appId='123')=>{const flow={stateDigest:await personalDigest('state',personalNonce()),browserDigest:await personalDigest('browser',personalNonce()),appId,redirectUri:'https://musely.net/api/threads/callback',createdAt:clock,expiresAt:clock+600000};assert.ok(auth.begin(flow));assert.ok(auth.consume(flow,clock));const sidDigest=await personalDigest('sid',personalNonce()),proof=auth.complete(flow.stateDigest,appId,subject,sidDigest,clock);return{sidDigest,proof,appId};};
 const helper=new PersonalLegacy({storage,auth,adoption:service,runtime,trust,connected,legacyProfile:legacy,now:()=>clock});
 return{db,storage,auth,registration,legacy,runtime,trust,connected,key,helper,binding,get service(){return service;},owner:()=>({principal:'owner',ownerId:'owner:kim-sejun',exp:clock+60000}),setClock:n=>clock=n,setHook:f=>hook=f,changeRoot:async()=>{root=await generateKeyPair(true);await trust.ensureAgents(await crypto.subtle.exportKey('jwk',root.privateKey));},restart:()=>{service=new PersonalAdoption(storage,auth,options);service.init();},setCommitEdit:f=>commitEdit=f,changeWorld:()=>{worldId='another-world';},get commits(){return commits;},get reads(){return reads;}};
}
const input=(operationId='adopt-one',expectedRevision=0,displayName='ComBba')=>({operationId,expectedRevision,displayName,appearanceId:'00-jolly'});
const dbText=a=>JSON.stringify(a.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,a.db.prepare('SELECT * FROM '+name).all()]));

const adopt=(a,b)=>a.helper.adopt(b,a.owner(),input());
test('availability needs valid active personal + owner, yet performs no adoption/connection write',async t=>{
 const a=await boot(t),b=await a.binding(),before=dbText(a);assert.deepEqual(a.helper.view(b,null),{available:false,adopted:false,profile:null,connection:{connected:false,lastSeenAt:null},entry:null});
 const v=a.helper.view(b,a.owner());assert.equal(v.available,true);assert.equal(v.profile.actorId,'00-jolly');assert.equal(v.entry,null);assert.equal(v.connection.connected,false);assert.equal(a.service.hasPrincipal(b.proof.principalId),false);assert.equal(dbText(a),before);
});
test('real adoption event/input/checkpoint joins legacy entry; receipt never asserts a connector execution',async t=>{
 const a=await boot(t),b=await a.binding(),v=adopt(a,b);assert.equal(v.adopted,true);assert.equal(v.entry.state,'joined');assert.equal(v.entry.receipt.kind,'legacy_adoption');assert.equal(v.entry.actor.id,'00-jolly');assert.equal(v.entry.attempt,null);assert.equal(v.connection.lastSeenAt,1_000_000);
 const before=dbText(a);assert.deepEqual(a.helper.view(b,null),v);assert.equal(dbText(a),before);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_actors').get().n,0);
});
for(const mode of ['paused','no-member','key-revoked','delegation-revoked','missing-event','bad-hash','wrong-kind','wrong-input','wrong-receipt-kind'])test('legacy '+mode+' cannot join while public ownership/profile remains',async t=>{
 const a=await boot(t),b=await a.binding();adopt(a,b);
 if(mode==='paused')a.runtime.commitExternal(1_000_001,'fixture-pause',s=>{s.paused??={};s.paused['00-jolly']={at:1_000_001,version:4,by:'fixture'};});
 if(mode==='no-member')a.runtime.commitExternal(1_000_001,'fixture-remove',s=>{s.muses=s.muses.filter(m=>m.id!=='00-jolly');});
 if(mode==='key-revoked')a.connected.keys.revoke(a.key.row.id,1_000_001);
 if(mode==='delegation-revoked')await a.trust.revoke('00-jolly');
 if(mode==='missing-event')a.db.prepare("DELETE FROM events WHERE kind='legacy_profile_updated'").run();
 if(mode==='bad-hash')a.db.prepare("UPDATE run_inputs SET after_snapshot=after_snapshot||' ' WHERE label='legacy-profile-1'").run();
 if(mode==='wrong-kind')a.db.prepare("UPDATE events SET kind='greet' WHERE kind='legacy_profile_updated'").run();
 if(mode==='wrong-input')a.db.prepare("UPDATE events SET input_seq=input_seq+99 WHERE kind='legacy_profile_updated'").run();
 if(mode==='wrong-receipt-kind'){const r=a.db.prepare('SELECT result FROM personal_legacy_adoptions').get(),v=JSON.parse(r.result);v.receipt.kind='personal_entry';a.db.prepare('UPDATE personal_legacy_adoptions SET result=?').run(JSON.stringify(v));}
 const before=dbText(a),v=a.helper.view(b,null);assert.equal(v.adopted,true);assert.equal(v.profile.actorId,'00-jolly');assert.equal(v.entry.state,'viewing');assert.equal(v.entry.receipt,null);assert.equal(v.entry.reason,mode==='paused'?'paused':'unavailable');assert.equal(dbText(a),before);
});
test('root changed remains reserved and unavailable; another principal never gains private legacy surface',async t=>{
 const a=await boot(t),b=await a.binding(),other=await a.binding('43');adopt(a,b);assert.equal(a.helper.view(other,a.owner()).available,false);assert.equal(a.helper.profile(other),null);assert.throws(()=>a.helper.inbox(other),code('adoption_required'));assert.throws(()=>a.helper.patchProfile(other,{expectedRevision:1,displayName:'Other',appearanceId:'00-jolly'}),code('adoption_required'));
 await a.changeRoot();const before=dbText(a),v=a.helper.view(b,null);assert.equal(v.adopted,true);assert.equal(v.entry.state,'viewing');assert.equal(v.entry.reason,'unavailable');assert.equal(a.service.hasPrincipal(b.proof.principalId),true);assert.throws(()=>a.helper.inbox(b));assert.equal(dbText(a),before);
});
test('owner expiry does not expire active alias; public PATCH changes current name without replay overwrite/key change',async t=>{
 const a=await boot(t),b=await a.binding(),v=adopt(a,b),r=a.service.get(b).receipt,beforeKeys=JSON.stringify(a.connected.keys.list('00-jolly'));a.setClock(a.owner().exp+1);
 const p=a.helper.patchProfile(b,{expectedRevision:1,displayName:'Current ComBba',appearanceId:'01-sunny'});assert.equal(p.revision,2);assert.equal(a.helper.profile(b).displayName,'Current ComBba');const current=a.helper.view(b,null);assert.equal(current.entry.state,'joined');assert.equal(current.entry.actor.profileRevision,2);assert.deepEqual(current.entry.receipt,v.entry.receipt);assert.equal(JSON.stringify(a.connected.keys.list('00-jolly')),beforeKeys);assert.equal(a.runtime.eventRecord(r.eventId).event.data.profile.displayName,'ComBba');const relogin=await a.binding('42');assert.equal(relogin.proof.principalId,b.proof.principalId);assert.equal(a.helper.view(relogin,null).entry.state,'joined');
});
test('pm registration and expired/revoked personal sessions never expose legacy inbox or availability',async t=>{
 const a=await boot(t),b=await a.binding();await a.registration.register(b,{operationId:'draft',displayName:'Mine',appearanceId:'00-jolly'});const before=dbText(a);assert.equal(a.helper.view(b,a.owner()).available,false);assert.equal(a.helper.profile(b),null);assert.throws(()=>a.helper.inbox(b),code('adoption_required'));assert.equal(dbText(a),before);
 const c=await a.binding('43');adopt(a,c);a.auth.revoke(c.sidDigest,c.proof,c.appId,1_000_000);assert.throws(()=>a.helper.view(c,null),code('personal_session_required'));assert.throws(()=>a.helper.inbox(c),code('personal_session_required'));
});
function tasks(a){a.runtime.commitExternal(1_000_000,'fixture-private-approvals',s=>{const make=(id,from,to)=>({id,kind:'meetup',from,to,status:'pending',awaiting:null,createdAt:1_000_000,deadline:1_600_000,updatedAt:1_000_000,round:0,history:[],stage:'owner_approval',owners:{[from]:from==='00-jolly'?'owner:kim-sejun':'system:reviewer',[to]:'system:demo-peer'},answers:{[from]:'accept',[to]:'accept'},candidates:[{id:'c1',time:'12:00',place:'Cafe',place_id:'commons:cafe',public_basis:'public'}],approvals:{}});s.inbox.tasks.push(make('task_own','00-jolly','09-copper'),make('task_other','04-ember','09-copper'));});}
test('only own alias inbox and actual00 participant approval reach ConnectedHost; no private reason fields',async t=>{
 const a=await boot(t),b=await a.binding();adopt(a,b);tasks(a);const box=a.helper.inbox(b);assert.ok(JSON.stringify(box).includes('task_own'));assert.ok(!JSON.stringify(box).includes('task_other'));
 const task=a.runtime.state().inbox.tasks.find(x=>x.id==='task_own'),base={taskId:task.id,revision:task.revision,contentHash:task.contentHash,decision:'reject',candidate:null};const before=dbText(a);
 for(const extra of [{reason:'PRIVATE_CANARY'},{muse:'04-ember'},{ownerId:'system:reviewer'}])assert.throws(()=>a.helper.approve(b,{...base,...extra}),code('invalid_approval'));
 const other=a.helper.approve(b,{...base,taskId:'task_other'});assert.equal(other.ok,false);assert.equal(other.code,'unknown_task');assert.equal(dbText(a),before);
 const out=a.helper.approve(b,base);assert.equal(out.ok,true);const changed=a.runtime.state().inbox.tasks.find(x=>x.id===task.id);assert.equal(changed.approvals['00-jolly'].by,'owner:kim-sejun');assert.equal(changed.status,'rejected');
});

test('an adoption receipt with an unused active legacy key proves entry only, not runtime connection',async t=>{const a=await boot(t),b=await a.binding();adopt(a,b);a.db.prepare('UPDATE agent_keys SET last_used_at=NULL').run();const before=dbText(a),v=a.helper.view(b,null);assert.equal(v.entry.state,'joined');assert.deepEqual(v.connection,{connected:false,lastSeenAt:null});assert.equal(dbText(a),before);});

test('owner expiry during final projection rolls the outer adoption transaction back',async t=>{const a=await boot(t),b=await a.binding(),owner=a.owner(),view=a.helper.view.bind(a.helper),before=dbText(a);a.helper.view=(...args)=>{const out=view(...args);a.setClock(owner.exp);return out;};assert.throws(()=>a.helper.adopt(b,owner,input()),code('owner_session_required'));assert.equal(dbText(a),before);});
