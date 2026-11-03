// Private alias store over real SQLite and real auth/profile/runtime modules; no HTTP/provider/key files.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
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
 const current=()=>{reads++;const {kty,crv,x,y}=root.publicJwk;return{actorId:'00-jolly',agentId:root.kid,rootBinding:canonicalize({kty,crv,x,y}),worldId,profile:legacy.get({principal:'owner',ownerId:'owner:kim-sejun',exp:clock+1})};};
 const options={now:()=>clock,currentLegacy:current,commitProfile:(owner,input)=>{commits++;const p=legacy.patch(owner,input),e=runtime.events().filter(x=>x.kind==='legacy_profile_updated').at(-1),record=db.prepare('SELECT after_hash FROM run_inputs WHERE seq=? AND run_id=?').get(e.inputSeq,e.runId);hook();return{profile:p,commit:commitEdit({worldId,runId:e.runId,inputSeq:e.inputSeq,eventSeq:e.seq,eventId:e.id,afterHash:record.after_hash})};}};
 let service=new PersonalAdoption(storage,auth,options);service.init();
 const binding=async(subject='42',appId='123')=>{const flow={stateDigest:await personalDigest('state',personalNonce()),browserDigest:await personalDigest('browser',personalNonce()),appId,redirectUri:'https://musely.net/api/threads/callback',createdAt:clock,expiresAt:clock+600000};assert.ok(auth.begin(flow));assert.ok(auth.consume(flow,clock));const sidDigest=await personalDigest('sid',personalNonce()),proof=auth.complete(flow.stateDigest,appId,subject,sidDigest,clock);return{sidDigest,proof,appId};};
 return{db,storage,auth,registration,legacy,runtime,binding,get service(){return service;},owner:()=>({principal:'owner',ownerId:'owner:kim-sejun',exp:clock+60000}),setClock:n=>clock=n,setHook:f=>hook=f,changeRoot:async()=>{root=await generateKeyPair(true);},restart:()=>{service=new PersonalAdoption(storage,auth,options);service.init();},setCommitEdit:f=>commitEdit=f,changeWorld:()=>{worldId='another-world';},get commits(){return commits;},get reads(){return reads;}};
}
const input=(operationId='adopt-one',expectedRevision=0,displayName='ComBba')=>({operationId,expectedRevision,displayName,appearanceId:'00-jolly'});
const dbText=a=>JSON.stringify(a.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,a.db.prepare('SELECT * FROM '+name).all()]));

test('dual proof creates only alias + existing current public profile once; restart replay returns original result',async t=>{
 const a=await boot(t),b=await a.binding(),owner=a.owner(),before=a.runtime.state(),oldRun=a.runtime.run?.();
 assert.equal(a.service.get(b),null);const reads=a.reads;assert.equal(a.service.hasPrincipal(b.proof.principalId),false);assert.equal(a.reads,reads);
 const first=a.service.adopt(b,owner,input());assert.deepEqual(first.profile,{actorId:'00-jolly',displayName:'ComBba',appearanceId:'00-jolly',revision:1});assert.equal(first.receipt.kind,'legacy_adoption');assert.match(first.receipt.id,/^lad_/);assert.equal(first.receipt.profileRevision,1);const event=a.runtime.events().find(e=>e.id===first.receipt.eventId);assert.equal(event.muse,'00-jolly');assert.equal(event.inputSeq,first.receipt.inputSeq);assert.equal(event.runId,first.receipt.runId);assert.equal(event.seq,first.receipt.eventSeq);assert.equal(a.db.prepare('SELECT after_hash FROM run_inputs WHERE seq=?').get(event.inputSeq).after_hash,first.receipt.afterHash);assert.equal(a.commits,1);assert.equal(a.service.hasPrincipal(b.proof.principalId),true);
 assert.equal(a.db.prepare('SELECT count(*) n FROM personal_actors').get().n,0);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_actor_roots').get().n,0);
 const {profile,...current}=a.runtime.state().muses.find(m=>m.id==='00-jolly');assert.deepEqual(current,before.muses.find(m=>m.id==='00-jolly'));assert.deepEqual(a.runtime.state().items,before.items);
 a.legacy.patch(owner,{expectedRevision:1,displayName:'Current ComBba',appearanceId:'01-sunny'});a.restart();const snapshot=dbText(a);
 assert.deepEqual(a.service.adopt(b,owner,input()),first);assert.equal(a.commits,1);assert.equal(dbText(a),snapshot);assert.equal(a.service.get(b).profile.displayName,'Current ComBba');assert.doesNotMatch(JSON.stringify(first),/principal|subject|root|private|sid|token/);
});
for(const bad of ['missing-personal','missing-owner','expired-owner','reviewer','demo','wrong-owner'])test('rejects '+bad+' proof without writes',async t=>{
 const a=await boot(t),b=await a.binding();let owner=a.owner();if(bad==='missing-owner')owner=null;if(bad==='expired-owner')owner.exp=0;if(bad==='reviewer')owner.principal='reviewer';if(bad==='demo')owner.principal='demo-peer';if(bad==='wrong-owner')owner.ownerId='owner:other';const before=dbText(a);assert.throws(()=>a.service.adopt(bad==='missing-personal'?null:b,owner,input()));assert.equal(dbText(a),before);assert.equal(a.commits,0);
});
for(const loss of ['expiry','logout','authVersion','app','subject','provider'])test('get and adoption reject changed '+loss+' binding; persistent reservation stays',async t=>{
 const a=await boot(t),b=await a.binding();a.service.adopt(b,a.owner(),input());if(loss==='expiry')a.setClock(b.proof.expiresAt);if(loss==='logout')a.auth.revoke(b.sidDigest,b.proof,b.appId,1_000_000);if(loss==='authVersion')a.db.prepare('UPDATE personal_principals SET auth_version=auth_version+1').run();if(loss==='app')b.appId='456';if(loss==='subject')a.db.prepare("UPDATE personal_principals SET subject='123:43'").run();if(loss==='provider')a.db.prepare("UPDATE personal_principals SET provider='other'").run();const before=dbText(a);assert.throws(()=>a.service.get(b));assert.throws(()=>a.service.adopt(b,a.owner(),input()));assert.equal(a.service.hasPrincipal(b.proof.principalId),true);assert.equal(dbText(a),before);
});
test('different principal/op/intent cannot take or relink 00; hasPrincipal and read do no writes',async t=>{
 const a=await boot(t),b=await a.binding(),other=await a.binding('43');a.service.adopt(b,a.owner(),input());const before=dbText(a);assert.equal(a.service.get(other),null);assert.throws(()=>a.service.adopt(other,a.owner(),input()),code('adoption_conflict'));assert.throws(()=>a.service.adopt(b,a.owner(),input('other-op')),code('adoption_conflict'));assert.throws(()=>a.service.adopt(b,a.owner(),input('adopt-one',0,'Other')),code('adoption_conflict'));assert.equal(dbText(a),before);
});
test('a principal already owning a pm actor cannot adopt; another app remains a distinct principal',async t=>{
 const a=await boot(t),b=await a.binding(),otherApp=await a.binding('42','456');assert.notEqual(otherApp.proof.principalId,b.proof.principalId);await a.registration.register(b,{operationId:'draft',displayName:'Mine',appearanceId:'00-jolly'});const before=dbText(a);assert.throws(()=>a.service.adopt(b,a.owner(),input()),code('adoption_conflict'));assert.equal(dbText(a),before);assert.equal(a.service.get(otherApp),null);
});
test('two independently authenticated principals race with exactly one alias and one profile commit',async t=>{
 const a=await boot(t),one=await a.binding('42'),two=await a.binding('43'),out=await Promise.allSettled([Promise.resolve().then(()=>a.service.adopt(one,a.owner(),input())),Promise.resolve().then(()=>a.service.adopt(two,a.owner(),input()))]);assert.equal(out.filter(x=>x.status==='fulfilled').length,1);assert.equal(out.find(x=>x.status==='rejected').reason.code,'adoption_conflict');assert.equal(a.commits,1);
});
for(const failure of ['alias-insert','after-profile','final-expiry'])test('entire alias/profile/world rollback at '+failure,async t=>{
 const a=await boot(t),b=await a.binding(),owner=a.owner();if(failure==='alias-insert')a.db.exec("CREATE TEMP TRIGGER stop_alias BEFORE INSERT ON personal_legacy_adoptions BEGIN SELECT RAISE(ABORT,'PRIVATE_SQL_CANARY'); END");if(failure==='after-profile')a.setHook(()=>{throw Error('PRIVATE_CALLBACK_CANARY');});if(failure==='final-expiry')a.setHook(()=>a.setClock(owner.exp));const before=dbText(a);assert.throws(()=>a.service.adopt(b,owner,input()),e=>e.code&&e.message===e.code&&!/CANARY/.test(e.message));assert.equal(dbText(a),before);assert.equal(a.service.hasPrincipal(b.proof.principalId),false);
});
test('changed root invalidates alias without reopening principal registration or relinking',async t=>{
 const a=await boot(t),b=await a.binding();a.service.adopt(b,a.owner(),input());await a.changeRoot();const before=dbText(a);assert.throws(()=>a.service.get(b),code('adoption_changed'));assert.throws(()=>a.service.adopt(b,a.owner(),input()),code('adoption_changed'));assert.equal(a.service.hasPrincipal(b.proof.principalId),true);assert.equal(dbText(a),before);
});
for(const value of [{...input(),actorId:'00-jolly'},input('bad op'),input('adopt-one',-1),{...input(),appearanceId:'unknown'},input('adopt-one',0,'x\n'),{...input(),rootBinding:'x'}])test('strict input rejects unsupported intent '+Object.keys(value).join(','),async t=>{const a=await boot(t),b=await a.binding(),before=dbText(a);assert.throws(()=>a.service.adopt(b,a.owner(),value),code('invalid_adoption'));assert.equal(dbText(a),before);});
for(const [field,value] of [['worldId','wrong-world'],['inputSeq',0],['inputSeq',1.5],['eventSeq',-1],['afterHash',['a'.repeat(64)]],['afterHash','short'],['eventId','PRIVATE EVENT CANARY'],['runId','']])test('invalid returned commit '+field+' rolls actual profile/event/alias back',async t=>{
 const a=await boot(t),b=await a.binding(),before=dbText(a);a.setCommitEdit(c=>({...c,[field]:value}));assert.throws(()=>a.service.adopt(b,a.owner(),input()),code('adoption_unavailable'));assert.equal(dbText(a),before);assert.equal(a.service.hasPrincipal(b.proof.principalId),false);
});
test('read binds original receipt world and works after original owner proof expires',async t=>{
 const a=await boot(t),b=await a.binding(),owner=a.owner(),out=a.service.adopt(b,owner,input());a.setClock(owner.exp+1);assert.deepEqual(a.service.get(b),out);a.changeWorld();assert.throws(()=>a.service.get(b),code('adoption_changed'));assert.equal(a.service.hasPrincipal(b.proof.principalId),true);
});
for(const loss of ['logout','authVersion','subject'])test('final personal '+loss+' check rolls profile and alias back',async t=>{
 const a=await boot(t),b=await a.binding(),before=dbText(a);a.setHook(()=>{if(loss==='logout')a.auth.revoke(b.sidDigest,b.proof,b.appId,1_000_000);if(loss==='authVersion')a.db.prepare('UPDATE personal_principals SET auth_version=auth_version+1').run();if(loss==='subject')a.db.prepare("UPDATE personal_principals SET subject='123:99'").run();});assert.throws(()=>a.service.adopt(b,a.owner(),input()));assert.equal(dbText(a),before);
});
