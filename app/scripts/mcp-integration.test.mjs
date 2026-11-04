// Local real TLS smoke; fixture credentials/storage and no model. This never proves production or Muse-account access.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {httpsWorld,JOLLY,COPPER,domainState} from './test-support/https-world.mjs';
import {HARNESS_IDS} from '../src/engine/harness.ts';
const data=r=>{assert.equal(r.isError,false,JSON.stringify(r));return r.structuredContent;};

test('I-03B peer schemas list every Muse, so all nine connected peers can address Jolly over verified TLS',async test=>{
 const t=await httpsWorld(test);
 const list=(await t.rpc(t.keys[COPPER].key,'tools/list')).body.result.tools;
 for(const tool of list){const p=tool.inputSchema.properties;if(p.to?.enum)assert.deepEqual(p.to.enum,HARNESS_IDS,tool.name);}
 for(const id of HARNESS_IDS.filter(x=>x!==JOLLY)){
  if(!t.keys[id])t.keys[id]=await t.dobj.connected.issueKey(id);
  const out=data(await t.tool(id,'greet',{to:JOLLY,text:'Hello Jolly'}));
  assert.equal(out.envelope.signer_kind,'server_custodial');assert.equal(out.envelope.verified,true);
  assert.equal(t.events().filter(e=>e.kind==='greet').at(-1).muse,id);
 }
});

test('I-03B self-target is decided from the caller Muse, never a hardcoded Jolly exclusion',async test=>{
 const t=await httpsWorld(test);
 t.edit(st=>{const m=st.muses.find(m=>m.id===COPPER);m.inventory.push('coffee','fruit','postage_stamp','postcard:commons:cafe','invite_token','spark','garden_pass');});
 for(const [tool,args,reason] of [
  ['greet',{to:COPPER,text:'hello'},'invalid_target'],
  ['propose_trade',{to:COPPER,give:'coffee',want:'fruit'},'invalid_target'],
  ['send_postcard',{to:COPPER,item:'postcard:commons:cafe'},'invalid_target'],
  ['give_gift',{to:COPPER,item:'coffee'},'invalid_target'],
  ['propose_meetup',{to:COPPER},'invalid_target'],
  ['propose_help',{to:COPPER,item:'paper_map'},'self_help'],
  ['invite_campfire',{to:[COPPER]},'self_invite'],
 ]){
  const before=structuredClone(domainState(t)),out=await t.tool(COPPER,tool,args);
  assert.equal(out.structuredContent?.refused,reason,tool);assert.deepEqual(domainState(t),before,tool+' has no domain side effects');
 }
});

let commandSeq=0;
async function once(t,muse,tool,args={}){
 const command_id='tls-'+tool.replaceAll('_','-')+'-'+String(++commandSeq).padStart(5,'0');
 const first=data(await t.tool(muse,tool,{...args,command_id}));
 assert.equal(first.command.duplicate,false);assert.equal(first.envelope.message_id,command_id);
 assert.equal(first.envelope.verified,true);assert.equal(first.envelope.signer_kind,'server_custodial');
 const row=t.dobj.runtime.commandRow(t.dobj.trust.agentByMuse(muse).agentId,command_id);
 assert.ok(row?.result.ok,tool+' stored its actual command result');
 const ev=t.events().filter(e=>row.result.eventIds.includes(e.id));assert.ok(ev.length,tool+' has committed events');
 assert.ok(ev.some(e=>e.data?.envelope?.message_id===command_id&&e.data.actorOrigin==='connected'&&e.data.tool===tool),tool+' envelope/event/actor correlation');
 const before=structuredClone(domainState(t)),events=t.events().length;
 const again=data(await t.tool(muse,tool,{...args,command_id}));
 assert.equal(again.command.duplicate,true);assert.deepEqual(again.envelope,first.envelope);
 assert.deepEqual(domainState(t),before,tool+' duplicate has no domain effects');assert.equal(t.events().length,events,tool+' duplicate emits nothing');
 return first;
}
const stocked=t=>t.edit(st=>{
 const j=st.muses.find(m=>m.id===JOLLY),c=st.muses.find(m=>m.id===COPPER);
 j.inventory=['coffee','postage_stamp','postcard:commons:cafe','invite_token','spark','paper_map','garden_pass','clover_seed'];
 c.inventory=['pocket_gadget','tea','fruit'];
 j.wants.items=['tea','fruit'];c.wants.items=['coffee'];
});
const validArgs={move:{to:'commons:workbench'},discover:{},craft:{recipe:'bloom'},greet:{text:'hello',to:COPPER},propose_trade:{to:COPPER,give:'coffee',want:'tea'},counter_trade:{task_id:'task_1',give:'coffee',want:'tea'},accept_trade:{task_id:'task_1'},reject_trade:{task_id:'task_1'},send_postcard:{to:COPPER,item:'postcard:commons:cafe'},give_gift:{to:COPPER,item:'coffee'},propose_meetup:{to:COPPER},answer_candidate:{task_id:'task_1',answer:'accept'},invite_campfire:{to:[COPPER]},propose_help:{to:COPPER,item:'paper_map'},answer_help:{task_id:'task_1',answer:'accept'},update_wants:{goal:'Find a postcard'}};

test('I-03B TLS read tools: registration, signed card, own world and heartbeat; peer memory and credentials stay private',async test=>{
 const t=await httpsWorld(test);
 const wire=await t.rpc(t.keys[JOLLY].key,'tools/list');assert.equal(wire.tls,true);assert.match(wire.tlsProtocol,/^TLSv1\.[23]$/);
 t.edit(st=>{st.muses.find(m=>m.id===JOLLY).memory=['owner-only-memory-marker'];st.muses.find(m=>m.id===COPPER).memory=['peer-only-memory-marker'];});
 const reg=data(await t.tool(COPPER,'register_agent'));assert.equal(reg.muse,COPPER);assert.equal(reg.signer_kind,'server_custodial');
 assert.equal(data(await t.tool(COPPER,'get_agent_card',{muse:JOLLY})).verification.ok,true);
 const world=data(await t.tool(COPPER,'get_world_state'));assert.equal(world.muse.id,COPPER);assert.ok(world.muse.memory.includes('peer-only-memory-marker'));assert.ok(!JSON.stringify(world).includes('owner-only-memory-marker'));
 assert.equal(data(await t.tool(COPPER,'heartbeat_check')).tasks_for_you.length,0);
 for(const output of [reg,world,data(await t.tool(COPPER,'get_agent_card')),data(await t.tool(COPPER,'heartbeat_check'))])assert.ok(!/msly_[A-Za-z0-9_-]{43}|private_keys|owner-control|"d":/.test(JSON.stringify(output)));
});

test('I-03B TLS tool matrix: move, discover, craft, greet, gift, postcard, invitation and wants each commit once and retry once',async test=>{
 for(const tool of ['move','discover','craft','greet','give_gift','send_postcard','invite_campfire','update_wants'])await test.test(tool,async child=>{
  const t=await httpsWorld(child);stocked(t);
  if(tool==='craft')t.edit(st=>{st.muses.find(m=>m.id===JOLLY).place='commons:garden';});
  const out=await once(t,JOLLY,tool,validArgs[tool]);
  if(tool==='move'){assert.ok(out.eta_ms>0);assert.equal(t.muse(JOLLY).travel.to,'commons:workbench');}
  if(tool==='craft'){assert.ok(t.muse(JOLLY).inventory.includes('bloom'));assert.ok(!t.muse(JOLLY).inventory.includes('clover_seed'));}
  if(tool==='give_gift')assert.ok(t.muse(COPPER).inventory.includes('coffee'));
  if(tool==='send_postcard'){assert.equal(t.state().inbox.mail.length,1);assert.equal(out.eta_ms,60_000);assert.ok(!t.muse(JOLLY).inventory.includes('postage_stamp'));}
 });
});

test('I-03B TLS trade matrix: both connected directions, inbox, two counters, atomic acceptance/receipt and rejection',async test=>{
 for(const end of ['accept_trade','reject_trade'])await test.test(end,async child=>{
  const t=await httpsWorld(child);stocked(t);
  const proposed=await once(t,JOLLY,'propose_trade',validArgs.propose_trade),id=proposed.task.id;
  const hb=data(await t.tool(COPPER,'heartbeat_check'));assert.equal(hb.tasks_for_you[0].id,id);assert.equal(hb.tasks_for_you[0].deadline,t.task(id).deadline);
  assert.equal((await t.tool(JOLLY,end,{task_id:id})).structuredContent.refused,'not_your_turn');
  await once(t,COPPER,'counter_trade',{task_id:id,give:'fruit',want:'coffee'});
  await once(t,JOLLY,'counter_trade',{task_id:id,give:'coffee',want:'tea'});
  assert.equal((await t.tool(COPPER,'counter_trade',{task_id:id,give:'fruit',want:'coffee'})).structuredContent.refused,'counter_limit');
  await once(t,COPPER,end,{task_id:id});
  assert.equal(t.task(id).status,end==='accept_trade'?'completed':'rejected');
  if(end==='accept_trade'){
   assert.ok(t.muse(JOLLY).inventory.includes('tea')&&!t.muse(JOLLY).inventory.includes('coffee'));
   assert.ok(t.muse(COPPER).inventory.includes('coffee')&&!t.muse(COPPER).inventory.includes('tea'));
   assert.equal(t.events().filter(e=>e.kind==='trade_completed').length,1);
   assert.deepEqual(t.state().inbox.notifications.filter(n=>n.kind==='trade_completed').map(n=>n.muse).sort(),[JOLLY,COPPER].sort());
  }
 });
});

test('I-03B TLS help matrix: request, need_item, requester input, connected completion and private inbox deadline',async test=>{
 const t=await httpsWorld(test);stocked(t);
 const opened=await once(t,JOLLY,'propose_help',validArgs.propose_help),id=opened.task.id;
 const hb=data(await t.tool(COPPER,'heartbeat_check'));assert.equal(hb.tasks_for_you[0].id,id);assert.ok(hb.tasks_for_you[0].deadline>Date.now());
 await once(t,COPPER,'answer_help',{task_id:id,answer:'need_item',item:'spark'});
 assert.equal(data(await t.tool(JOLLY,'heartbeat_check')).tasks_for_you[0].id,id);
 await once(t,JOLLY,'answer_help',{task_id:id,answer:'accept'});
 await once(t,COPPER,'answer_help',{task_id:id,answer:'accept'});
 assert.equal(t.task(id).status,'completed');assert.ok(t.muse(JOLLY).inventory.includes('repaired_gadget'));assert.ok(!t.muse(JOLLY).inventory.includes('spark'));
 assert.equal(t.events().filter(e=>e.kind==='help_completed').at(-1).data.accepted_via,'live');
});

const decision=(task,candidate,override={})=>({taskId:task.id,revision:task.revision,contentHash:task.contentHash,decision:'approve',candidate,...override});
test('I-03B TLS meetup matrix: Copper→Jolly, accept/reject only, both owners bind revision/hash/candidate and approval_refs',async test=>{
 const t=await httpsWorld(test);stocked(t);
 const meet=await once(t,COPPER,'propose_meetup',{to:JOLLY}),id=meet.task.id;
 await once(t,JOLLY,'answer_candidate',{task_id:id,answer:'accept'});
 const yes=await once(t,COPPER,'answer_candidate',{task_id:id,answer:'accept'});assert.equal(yes.owner_approval,'required');
 const task=t.task(id),candidate=task.candidates[0],body=decision(task,candidate.id);
 assert.equal((await t.decide(JOLLY,{...body,muse:COPPER})).status,400,'caller cannot choose another owner Muse');
 assert.equal((await t.decide(JOLLY,{...body,contentHash:'0'.repeat(64)})).body.error,'stale_approval');
 assert.equal((await t.decide(JOLLY,body)).body.confirmed,false);
 assert.equal((await t.decide(COPPER,decision(t.task(id),task.candidates[1].id))).body.error,'candidate_mismatch');
 const confirmed=await t.decide(COPPER,body);assert.equal(confirmed.status,200);assert.equal(confirmed.body.confirmed,true);
 const event=t.events().find(e=>e.kind==='meetup_confirmed');assert.equal(event.data.task_id,id);assert.equal(event.data.revision,body.revision);
 assert.deepEqual(event.data.approval_refs.sort(),Object.values(t.task(id).approvals).map(x=>x.ref).sort());
 assert.equal((await t.decide(COPPER,body)).body.duplicate,true);
 for(const id2 of [JOLLY,COPPER])assert.equal(t.muse(id2).inventory.filter(x=>x==='meetup_ember').length,1);
 // Candidate details never enter public events, world state, notifications, snapshots or recorded command inputs.
 for(const path of ['/api/world/events?limit=5000','/api/world/highlights','/api/world','/api/owner/notifications']){
  const raw=JSON.stringify((await t.go('GET',path)).body);assert.ok(!raw.includes(candidate.time),path+' time');assert.ok(!raw.includes('owner-private-condition-marker'),path+' private reason');
 }
 const mine=(await t.go('GET','/api/owner/inbox',undefined,{cookie:t.cookies[JOLLY]})).body;
 assert.ok(JSON.stringify(mine).includes(candidate.time),'owner alone sees the exact candidate');
});

test('I-03B every write refuses a real root-signed delegation without its scope, spends no nonce and creates no command',async test=>{
 const t=await httpsWorld(test);stocked(t);
 const {issueDelegation,peekDelegation}=await import('../src/identity/delegation.ts');
 const {importPrivateJwk}=await import('../src/identity/jws.ts');
 const root=await importPrivateJwk(JSON.parse(t.env.OWNER_ROOT_JWK)),trust=t.dobj.trust;
 const original=trust.custodialExecutor.bind(trust);
 trust.custodialExecutor=async(...args)=>{
  const exec=await original(...args),token=await issueDelegation(root,exec.key,{signerKind:'server_custodial',version:exec.d.version,ttlMs:3_600_000,scopes:[]});
  return {...exec,delegation:token,d:peekDelegation(token)};
 };
 for(const [tool,args] of Object.entries(validArgs)){
  const before=structuredClone(domainState(t)),out=await t.tool(JOLLY,tool,args);
  assert.equal(out.structuredContent?.refused,'scope_not_delegated',tool);assert.deepEqual(domainState(t),before,tool);
 }
 assert.equal(t.sql.exec('SELECT count(*) n FROM commands').toArray()[0].n,0);
 assert.equal(t.sql.exec('SELECT count(*) n FROM nonces').toArray()[0].n,0);
});

test('I-03B every tool rejects actor/owner/signed spoofing; reasons never enter input or stored events',async test=>{
 const t=await httpsWorld(test);stocked(t);
 const tools=(await t.rpc(t.keys[COPPER].key,'tools/list')).body.result.tools;
 for(const tool of tools)for(const field of ['actor_id','owner_claimed','signed']){
  const args={...(validArgs[tool.name]??{}),[field]:'private-reason-never-store'};
  const before=structuredClone(domainState(t)),out=await t.tool(COPPER,tool.name,args);
  assert.equal(out.error?.code,-32602,tool.name+' '+field);assert.deepEqual(domainState(t),before,tool.name);
 }
 for(const tool of ['answer_candidate','answer_help','reject_trade']){
  const out=await t.tool(JOLLY,tool,{...validArgs[tool],reason:'private-reason-never-store'});assert.equal(out.error.code,-32602);
 }
 assert.ok(!JSON.stringify(t.events()).includes('private-reason-never-store'));
 assert.equal(t.sql.exec('SELECT count(*) n FROM commands').toArray()[0].n,0);
});

test('I-03B pending claim refuses every claim-gated tool without moving inventory/tasks; reads remain available',async test=>{
 const t=await httpsWorld(test);stocked(t);t.claim(false);
 for(const tool of ['propose_trade','counter_trade','accept_trade','send_postcard','give_gift','propose_meetup','answer_candidate','invite_campfire','propose_help','answer_help']){
  const before=structuredClone(domainState(t)),out=await t.tool(JOLLY,tool,validArgs[tool]);
  assert.equal(out.structuredContent?.refused,'pending_claim',tool);assert.deepEqual(domainState(t),before,tool);
 }
 assert.equal(data(await t.tool(JOLLY,'register_agent')).claim.status,'pending_claim');
 assert.equal(data(await t.tool(JOLLY,'get_world_state')).muse.id,JOLLY);
});

test('I-03B owner revocation refuses every write; revoked key cannot read even a previously stored command',async test=>{
 const t=await httpsWorld(test);stocked(t);
 const prior=await once(t,JOLLY,'greet',{text:'before revocation'});
 const revoke=await t.go('POST','/api/owner/revoke',{muse:JOLLY},{origin:t.origin,cookie:t.cookies[JOLLY]});assert.equal(revoke.status,200);
 for(const [tool,args] of Object.entries(validArgs)){
  const before=structuredClone(domainState(t)),out=await t.tool(JOLLY,tool,args);
  assert.equal(out.structuredContent?.refused,'delegation_revoked',tool);assert.deepEqual(domainState(t),before,tool);
 }
 assert.equal(data(await t.tool(JOLLY,'heartbeat_check')).read_only,true);
 const closed=await t.go('DELETE','/api/agent-keys/'+t.keys[JOLLY].id,undefined,{origin:t.origin,cookie:t.cookies[JOLLY]});assert.equal(closed.status,200);
 for(const tool of [...Object.keys(validArgs),'register_agent','get_agent_card','get_world_state','heartbeat_check']){
  const out=await t.rpc(t.keys[JOLLY].key,'tools/call',{name:tool,arguments:validArgs[tool]??{}});assert.equal(out.status,401,tool);
 }
 assert.equal((await t.rpc(t.keys[JOLLY].key,'tools/call',{name:'greet',arguments:{text:'before revocation',command_id:prior.command.command_id}})).status,401,'auth rejects before stored-result lookup');
});

test('I-03B heartbeat exposes trade/meetup/help/invite deadlines, expires all kinds, and expired answers never reward',async test=>{
 const t=await httpsWorld(test);stocked(t);
 const trade=data(await t.tool(JOLLY,'propose_trade',validArgs.propose_trade)).task.id;
 const meet=data(await t.tool(JOLLY,'propose_meetup',validArgs.propose_meetup)).task.id;
 const help=data(await t.tool(JOLLY,'propose_help',validArgs.propose_help)).task.id;
 data(await t.tool(JOLLY,'invite_campfire',validArgs.invite_campfire));
 const before=data(await t.tool(COPPER,'heartbeat_check'));assert.deepEqual(before.tasks_for_you.map(x=>x.id).sort(),[trade,meet,help].sort());
 for(const task of before.tasks_for_you)assert.equal(task.deadline,t.task(task.id).deadline);
 assert.equal(before.campfire_invites.open.length,1);
 t.edit(st=>{for(const x of st.inbox.tasks)x.deadline=Date.now()-1;for(const x of st.inbox.invites)x.expiresAt=Date.now()-1;});
 const hb=data(await t.tool(COPPER,'heartbeat_check'));assert.equal(hb.tasks_for_you.length,0);assert.equal(hb.expired_now.length,3);assert.equal(hb.campfire_invites.open.length,0);
 for(const [tool,id] of [['counter_trade',trade],['accept_trade',trade],['reject_trade',trade],['answer_candidate',meet],['answer_help',help]]){
  const inventory=t.state().muses.map(x=>structuredClone(x.inventory));
  assert.equal((await t.tool(COPPER,tool,{...validArgs[tool],task_id:id})).structuredContent.refused,'task_expired',tool);
  assert.deepEqual(t.state().muses.map(x=>x.inventory),inventory,tool);
 }
 assert.equal(t.events().filter(e=>['trade_completed','help_completed','meetup_confirmed'].includes(e.kind)).length,0);
});

test('I-03B Copper→Jolly gift/postcard and inbox are real peer operations; help without a service is a business refusal',async test=>{
 const t=await httpsWorld(test);stocked(t);
 t.edit(st=>st.muses.find(x=>x.id===COPPER).inventory.push('coffee','postage_stamp','postcard:commons:cafe'));
 await once(t,COPPER,'give_gift',{to:JOLLY,item:'coffee'});
 await once(t,COPPER,'send_postcard',{to:JOLLY,item:'postcard:commons:cafe',text:'A short public note'});
 await t.dobj.runtime.heartbeat(Date.now()+61_000);
 const hb=data(await t.tool(JOLLY,'heartbeat_check'));
 assert.ok(hb.messages.some(m=>m.kind==='gift'&&m.from===COPPER));
 assert.ok(hb.messages.some(m=>m.kind==='postcard'&&/<untrusted_data[^>]*>A short public note<\/untrusted_data>/.test(m.text)));
 assert.equal(data(await t.tool(JOLLY,'heartbeat_check')).messages.length,0);
 const noService=await t.tool(COPPER,'propose_help',{to:JOLLY,item:'pocket_gadget'});assert.equal(noService.structuredContent.refused,'no_help_service');
});

test('I-03B deadline is checked at the commit after asynchronous peer verification, never at request start alone',async test=>{
 const t=await httpsWorld(test);stocked(t);
 let clock=Date.now();test.mock.method(Date,'now',()=>clock);
 const id=data(await t.tool(JOLLY,'propose_trade',validArgs.propose_trade)).task.id;
 t.edit(st=>{st.inbox.tasks.find(x=>x.id===id).deadline=clock+1_000;});
 const trust=t.dobj.trust,card=trust.card.bind(trust);
 let entered,release;const started=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);
 trust.card=async(...args)=>{entered();await hold;return card(...args);};
 const pending=t.tool(COPPER,'accept_trade',{task_id:id});
 await started;clock+=2_000;release();
 const out=await pending;assert.equal(out.structuredContent.refused,'task_expired');
 assert.equal(t.task(id).status,'expired');assert.ok(!t.events().some(e=>e.kind==='trade_completed'));
});

test('I-03B claim withdrawn during peer verification cannot authorize a later commit',async test=>{
 const t=await httpsWorld(test);stocked(t);
 const trust=t.dobj.trust,card=trust.card.bind(trust);
 let entered,release;const started=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);
 trust.card=async(...args)=>{entered();await hold;return card(...args);};
 const pending=t.tool(JOLLY,'propose_trade',validArgs.propose_trade);
 await started;t.claim(false);release();
 const before=structuredClone(domainState(t)),out=await pending;
 assert.equal(out.structuredContent.refused,'pending_claim');assert.deepEqual(domainState(t),before);
});

test('I-03B commit rechecks envelope expiry and peer/actor revocation after an async card check',async test=>{
 for(const fault of ['envelope_expired','actor_revoked','peer_revoked','peer_claim_withdrawn'])await test.test(fault,async child=>{
  const t=await httpsWorld(child);stocked(t);let clock=Date.now();child.mock.method(Date,'now',()=>clock);
  const id=data(await t.tool(JOLLY,'propose_trade',validArgs.propose_trade)).task.id;
  const trust=t.dobj.trust,card=trust.card.bind(trust);let entered,release;
  const started=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);
  trust.card=async(...args)=>{entered();await hold;return card(...args);};
  const pending=fault==='peer_claim_withdrawn'?t.tool(COPPER,'greet',{to:JOLLY,text:'must remain unspoken'}):t.tool(COPPER,'accept_trade',{task_id:id});await started;
  if(fault==='envelope_expired')clock+=120_001;
  else if(fault==='peer_claim_withdrawn')t.claim(false);
  else {const muse=fault==='actor_revoked'?COPPER:JOLLY;assert.equal((await t.go('POST','/api/owner/revoke',{muse},{origin:t.origin,cookie:t.cookies[muse]})).status,200);}
  const inventory=t.state().muses.map(x=>structuredClone(x.inventory));release();const out=await pending;
  assert.equal(out.isError,true,fault);assert.equal(out.structuredContent.refused,fault==='envelope_expired'?'expired':fault==='peer_claim_withdrawn'?'counterparty_pending_claim':fault==='peer_revoked'?'counterparty_delegation_revoked':'delegation_revoked');
  assert.deepEqual(t.state().muses.map(x=>x.inventory),inventory);assert.ok(!t.events().some(e=>e.kind==='trade_completed'));
 });
});

test('I-03B a mismatched custodial signing key fails real signature verification before nonce and commit',async test=>{
 const t=await httpsWorld(test),trust=t.dobj.trust,original=trust.custodialExecutor.bind(trust);
 const wrong=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 trust.custodialExecutor=async(...args)=>{const exec=await original(...args);return {...exec,key:{...exec.key,privateKey:wrong.privateKey}};};
 const before=structuredClone(domainState(t)),out=await t.tool(JOLLY,'greet',{text:'must not commit'});
 assert.equal(out.structuredContent.refused,'bad_signature');assert.equal(out.structuredContent.envelope.verified,false);
 assert.deepEqual(domainState(t),before);assert.equal(t.sql.exec('SELECT count(*) n FROM nonces').toArray()[0].n,0);assert.equal(t.sql.exec('SELECT count(*) n FROM commands').toArray()[0].n,0);
});

test('I-03B stored command survives WorldDO restart; payload conflict/stale version spend nothing extra',async test=>{
 const t=await httpsWorld(test);stocked(t);
 const first=await once(t,COPPER,'give_gift',{to:JOLLY,item:'tea'}),id=first.command.command_id;
 const before=structuredClone(domainState(t));await t.restart();
 const duplicate=data(await t.tool(COPPER,'give_gift',{to:JOLLY,item:'tea',command_id:id}));assert.equal(duplicate.command.duplicate,true);assert.deepEqual(domainState(t),before);
 const bad=await t.tool(COPPER,'give_gift',{to:JOLLY,item:'fruit',command_id:id});assert.equal(bad.structuredContent.refused,'command_conflict');assert.deepEqual(domainState(t),before);
 const stale=await t.tool(COPPER,'greet',{text:'old plan',command_id:'stale-retry-00001',expected_version:t.state().version+1});assert.equal(stale.structuredContent.refused,'stale_world');assert.equal(stale.structuredContent.command.world_version,t.state().version);assert.deepEqual(domainState(t),before);
 const retry=data(await t.tool(COPPER,'greet',{text:'old plan',command_id:'stale-retry-00001',expected_version:t.state().version}));assert.equal(retry.command.duplicate,false);
});

test('a bearer key revoked during peer verification cannot commit an in-flight action',async test=>{
 const t=await httpsWorld(test),trust=t.dobj.trust,card=trust.card.bind(trust);
 await t.dobj.connected.issueKey(COPPER); // a second active key cannot revive the revoked original bearer
 let entered,release;
 const started=new Promise(r=>entered=r),hold=new Promise(r=>release=r);
 trust.card=async(...args)=>{entered();await hold;return card(...args);};
 const pending=t.tool(COPPER,'greet',{to:JOLLY,text:'This action must be revoked',command_id:'key-revoke-await-001'});
 await started;
 t.dobj.connected.revokeKey(t.keys[COPPER].id);
 const before=structuredClone(domainState(t));
 release();const out=await pending;
 console.log(JSON.stringify({isError:out.isError,refused:out.structuredContent?.refused,greetings:t.events().filter(e=>e.kind==='greet').length}));
 assert.equal(out.isError,true);
 assert.deepEqual(domainState(t),before);
 assert.equal(t.events().filter(e=>e.kind==='greet').length,0);
 assert.equal(t.sql.exec('SELECT count(*) AS n FROM commands').toArray()[0].n,0);
 assert.equal(t.sql.exec('SELECT count(*) AS n FROM nonces').toArray()[0].n,0);
});
