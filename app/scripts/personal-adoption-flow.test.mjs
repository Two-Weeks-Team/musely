// Actual localhost TLS -> Worker/WorldDO/SQLite; synthetic signed sessions, no provider or production calls.
import test from 'node:test';import assert from 'node:assert/strict';import{createHash}from'node:crypto';
import{httpsWorld,JOLLY,COPPER}from'./test-support/https-world.mjs';
import{personalNonce,personalDigest,signPersonalSession}from'../worker/core/personal-session.ts';
const PATH='/api/personal/legacy-muse';
async function personal(a,subject='987654321'){
 const at=Date.now(),auth=a.dobj.personalAuth,appId=a.env.THREADS_APP_ID='123456789';a.env.THREADS_APP_SECRET='synthetic-app-secret';
 const stateDigest=await personalDigest('state',personalNonce()),browserDigest=await personalDigest('browser',personalNonce()),sid=personalNonce(),sidDigest=await personalDigest('sid',sid);
 const flow={stateDigest,browserDigest,appId,redirectUri:a.origin+'/api/threads/callback',createdAt:at,expiresAt:at+600000};assert.equal(auth.begin(flow),true);assert.equal(auth.consume(flow,at),true);const proof=auth.complete(stateDigest,appId,subject,sidDigest,at);assert.ok(proof);
 const token=await signPersonalSession(a.env.SESSION_SECRET,{v:1,sid,...proof},at);return{cookie:'musely_p='+token,binding:{sidDigest,appId,proof}};
}
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const tables=a=>Object.fromEntries(['agent_keys','private_keys','agents','delegation_versions','executors','revoked','delegated','claims'].map(name=>[name,hash(a.db.prepare('SELECT * FROM '+name).all())]));
const headers=(a,p,legacy=a.cookies[JOLLY])=>({origin:a.origin,cookie:p.cookie+(legacy?'; '+legacy:'')});
const intent=p=>({operationId:'adopt-synthetic-01',displayName:p.displayName,appearanceId:p.appearanceId,expectedRevision:p.revision});
test('legacy availability needs both current proofs; ordinary watching and a personal login never adopt',async t=>{
 const a=await httpsWorld(t),p=await personal(a),before=hash(a.state());
 assert.equal((await a.go('GET',PATH,undefined,{cookie:a.cookies[JOLLY]})).status,401);
 let r=await a.go('GET',PATH,undefined,headers(a,p,''));assert.equal(r.status,200);assert.equal(r.body.available,false);assert.equal(r.body.adopted,false);
 r=await a.go('GET',PATH,undefined,headers(a,p));assert.equal(r.status,200);assert.equal(r.body.available,true);assert.equal(r.body.adopted,false);assert.equal(r.body.profile.actorId,JOLLY);assert.equal(r.body.entry,null);
 assert.equal(hash(a.state()),before);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_actors').get().n,0);
});
test('dual-proof explicit adoption preserves legacy authority and connects the current profile across restart',async t=>{
 const a=await httpsWorld(t),p=await personal(a),view=await a.go('GET',PATH,undefined,headers(a,p));assert.equal(view.status,200);
 const input=intent(view.body.profile),protectedBefore=tables(a),world=a.state(),r=await a.go('POST',PATH,input,headers(a,p));assert.equal(r.status,200);assert.equal(r.body.adopted,true);assert.equal(r.body.entry.state,'joined');assert.equal(r.body.entry.receipt.kind,'legacy_adoption');assert.equal(r.body.profile.revision,input.expectedRevision+1);
 assert.deepEqual(tables(a),protectedBefore);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_actors WHERE actor_id=?').get(JOLLY).n,0);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_authority').get().n,0);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_entry_receipts').get().n,0);
 const after=hash(a.state()),again=await a.go('POST',PATH,input,headers(a,p));assert.equal(again.status,200);assert.deepEqual(again.body.entry.receipt,r.body.entry.receipt);assert.equal(hash(a.state()),after);
 assert.equal((await a.go('POST','/api/personal/draft',{operationId:'must-not-create',displayName:'Other',appearanceId:JOLLY},headers(a,p,''))).status,409);
 await a.restart();const read=await a.go('GET',PATH,undefined,headers(a,p,''));assert.equal(read.status,200);assert.equal(read.body.adopted,true);assert.equal(read.body.entry.state,'joined');assert.deepEqual(read.body.entry.receipt,r.body.entry.receipt);
 const profile=await a.go('GET','/api/personal/profile',undefined,headers(a,p,''));assert.equal(profile.status,200);assert.deepEqual(profile.body.profile,read.body.profile);
 assert.deepEqual(tables(a),protectedBefore);assert.deepEqual(a.state().items,world.items);assert.deepEqual(a.state().paused,world.paused);
});
test('peer, forged owner cookie, cross-origin and stale intent cannot create or change an alias',async t=>{
 const a=await httpsWorld(t),p=await personal(a),v=await a.go('GET',PATH,undefined,headers(a,p));assert.equal(v.status,200);const input=intent(v.body.profile),before=hash(a.state());
 for(const legacy of [a.cookies[COPPER],'musely_o=forged',''])assert.ok([401,403].includes((await a.go('POST',PATH,input,headers(a,p,legacy))).status));
 assert.equal((await a.go('POST',PATH,input,{...headers(a,p),origin:'https://other.invalid'})).status,403);
 assert.equal((await a.go('POST',PATH,{...input,expectedRevision:input.expectedRevision+1},headers(a,p))).status,409);assert.equal(hash(a.state()),before);
});
test('adoption wins over an already-started draft keygen without persisting a second actor or root',async t=>{
 const a=await httpsWorld(t),p=await personal(a),view=await a.go('GET',PATH,undefined,headers(a,p));assert.equal(view.status,200);
 let ready,release;const entered=new Promise(r=>ready=r),hold=new Promise(r=>release=r),registration=a.dobj.personalRegistration,generate=registration.generateRoot;registration.generateRoot=async()=>{ready();await hold;return generate();};
 const pending=a.go('POST','/api/personal/draft',{operationId:'inflight-draft',displayName:'Unrelated',appearanceId:JOLLY},headers(a,p,''));await entered;
 try{const r=await a.go('POST',PATH,intent(view.body.profile),headers(a,p));assert.equal(r.status,200);}finally{release();}
 assert.equal((await pending).status,409);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_actors').get().n,0);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_actor_roots').get().n,0);
});
test('logout during owner proof verification and rotated owner credential cannot commit a binding',async t=>{
 for(const mode of ['logout','owner_rotation']){
  const a=await httpsWorld(t),p=await personal(a),view=await a.go('GET',PATH,undefined,headers(a,p));assert.equal(view.status,200);const before=hash(a.state());
  if(mode==='owner_rotation')a.env.OWNER_CONTROL_TOKEN='rotated-synthetic-owner-token-00000001';
  else{const old=a.dobj.adoptionOwner.bind(a.dobj);a.dobj.adoptionOwner=async cookie=>{const proof=await old(cookie);a.dobj.personalAuth.revoke(p.binding.sidDigest,p.binding.proof,p.binding.appId);return proof;};}
  const r=await a.go('POST',PATH,intent(view.body.profile),headers(a,p));assert.equal(r.status,mode==='logout'?401:403);assert.equal(hash(a.state()),before);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_legacy_adoptions').get().n,0);
 }
});
test('adopted account edits its profile and answers its original canonical-owner Task without a legacy cookie',async t=>{
 const a=await httpsWorld(t),p=await personal(a),other=await personal(a,'987654322');
 const available=await a.go('GET',PATH,undefined,headers(a,p));assert.equal((await a.go('POST',PATH,intent(available.body.profile),headers(a,p))).status,200);
 const changed=await a.go('PATCH','/api/personal/profile',{expectedRevision:1,displayName:'ComBba connected'},headers(a,p,''));assert.equal(changed.status,200);assert.equal(changed.body.profile.actorId,JOLLY);assert.equal(changed.body.profile.revision,2);
 const status=await a.go('GET','/api/personal/status',undefined,headers(a,p,''));assert.equal(status.body.kind,'legacy_adoption');assert.equal(status.body.entry.state,'joined');assert.equal(status.body.profile.displayName,'ComBba connected');
 const proposed=(await a.tool(COPPER,'propose_meetup',{to:JOLLY})).structuredContent;assert.ok(proposed.task);const id=proposed.task.id;
 assert.equal((await a.tool(JOLLY,'answer_candidate',{task_id:id,answer:'accept'})).isError,false);assert.equal((await a.tool(COPPER,'answer_candidate',{task_id:id,answer:'accept'})).isError,false);
 const task=a.task(id);assert.equal(task.owners[JOLLY],'owner:kim-sejun');
 const inbox=await a.go('GET','/api/personal/inbox',undefined,headers(a,p,''));assert.equal(inbox.status,200);assert.ok(JSON.stringify(inbox.body).includes(id));assert.equal((await a.go('GET','/api/personal/inbox',undefined,headers(a,other,''))).status,403);
 const decision={taskId:id,revision:task.revision,contentHash:task.contentHash,decision:'approve',candidate:'c1'};
 assert.equal((await a.go('POST','/api/personal/approvals',decision,headers(a,other,''))).status,403);
 const own=await a.go('POST','/api/personal/approvals',decision,headers(a,p,''));assert.equal(own.status,200);assert.equal(own.body.confirmed,false);
 const peer=await a.decide(COPPER,decision);assert.equal(peer.status,200);assert.equal(peer.body.confirmed,true);assert.equal(a.task(id).owners[JOLLY],'owner:kim-sejun');
 assert.doesNotMatch(JSON.stringify([inbox.body,own.body,a.events()]),/987654321|987654322|musely_p=|msly_[A-Za-z0-9_-]{43}/);
});
test('an exhausted optional replay archive cannot strand a valid existing-Muse account connection',async t=>{
 const a=await httpsWorld(t),p=await personal(a),v=await a.go('GET',PATH,undefined,headers(a,p));assert.equal(v.status,200);
 a.db.prepare('UPDATE run_counts SET replay_bytes=?').run(64*1024*1024);
 const r=await a.go('POST',PATH,intent(v.body.profile),headers(a,p));assert.equal(r.status,200);assert.equal(r.body.adopted,true);assert.equal(r.body.entry.state,'joined');
 const original=a.dobj.runtime.runLog.lastInput();assert.equal(original.afterSnapshotError,'replay_storage_limit');assert.equal(original.afterSnapshot,null);
 await a.restart();const read=await a.go('GET',PATH,undefined,headers(a,p,''));assert.equal(read.body.entry.state,'joined');assert.deepEqual(read.body.entry.receipt,r.body.entry.receipt);
});
