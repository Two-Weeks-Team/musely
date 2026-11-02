import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {signedVerdict,validateReference} from './lib/demo-video.mjs';
const observed=JSON.parse(await readFile(new URL('./test-support/stored-mcp-public.json',import.meta.url)));
test('actual task_f public metadata alone never invents an exported MCP verdict or model request',()=>{
 for(const b of observed.records){
  const e=b.event,ref={eventId:e.id,runId:e.runId,inputSeq:e.inputSeq,originalSource:e.source,role:'stored-original-mcp',signedVerdict:'verified'};
  assert.equal(signedVerdict(e),null);assert.equal(e.data.evidence?.requestId,undefined);
  assert.deepEqual(validateReference(ref,b),['model_request_or_signed_verdict_required']);
  assert.deepEqual(validateReference({...ref,role:'support',signedVerdict:null},b),[]);
 }
});
test('owner approvals and confirmation remain external owner events without signed MCP evidence',()=>{
 const rows=observed.records.filter(b=>b.event.kind!=='meetup_answer');assert.equal(rows.length,3);
 for(const b of rows){assert.equal(b.input.kind,'external');assert.equal(b.input.input.action,'owner_approval');assert.equal(b.event.data.envelope,undefined);assert.equal(signedVerdict(b.event),null);}
 assert.deepEqual(rows.at(-1).event.data.approval_refs,['ap_i','ap_j']);
});

import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPlan,verifyBundle,sha} from './lib/demo-video.mjs';
// These bytes were publicly observed, but this plan/media setup is an offline test, never footage.
const actualReceipt=JSON.parse(await readFile(new URL('./test-support/stored-mcp-receipt.json',import.meta.url)));
async function storedBundle(t){
 const dir=await mkdtemp(join(tmpdir(),'d05-stored-offline-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const save=async(file,value)=>{const raw=JSON.stringify(value);await writeFile(join(dir,file),raw);return{file,sha256:sha(raw)};};
 const p=createPlan();Object.assign(p.release,{frozen:true,sourceSha:actualReceipt.sourceSHA,deployId:actualReceipt.deployId,workerVersion:actualReceipt.workerVersion,configVersion:'OFFLINE TEST',htmlSha256:'b'.repeat(64),modelIds:['OFFLINE MODEL FIXTURE'],attestation:'OFFLINE NOT ACCEPTANCE'});for(const k in p.review)p.review[k]=true;p.tooling={version:'musely-demo-tools-2',sourceSha:'f'.repeat(40)};
 for(const c of p.cuts){
  c.refs=[];for(const runId of(c.id==='s05'?['fixture-A','fixture-B']:['fixture-A'])){const r={eventId:'OFFLINE-'+runId,runId,inputSeq:1,originalSource:'live',requestId:'OFFLINE-MODEL-'+runId},b={runId,runIdStored:true,run:{runId,schemaVersion:'run-log-2'},input:{runId,seq:1},event:{id:r.eventId,runId,inputSeq:1,source:'live',data:{evidence:{requestId:r.requestId}}}};Object.assign(r,await save(c.id+'-'+runId+'.json',b));c.refs.push(r);}
  c.seekSec=0;c.snapshotHash='c'.repeat(64);if(c.id==='s05')c.views=['before','after'].map((id,i)=>({id,runId:c.refs[i].runId,duration:10,seekSec:0,snapshotHash:(i?'d':'c').repeat(64)}));
 }
 const c=p.cuts[6];c.refs=[];
 for(const b of observed.records){const e=b.event,r={eventId:e.id,runId:e.runId,inputSeq:e.inputSeq,originalSource:e.source,role:e.kind==='meetup_answer'?'stored-original-mcp':'support'};Object.assign(r,await save('actual-'+e.seq+'.json',b));c.refs.push(r);}
 const anchor=observed.records[0],confirmed=observed.records.at(-1);c.seekSec=Math.ceil((confirmed.event.data.publishedAt-anchor.run.startedAt)/100)/10;c.snapshotHash=confirmed.input.afterHash;
 c.storedMcpVerifier={label:'STORED ORIGINAL SERVER VERIFICATION',provenance:'OPERATOR MCP',receipt:await save('actual-duplicate-receipt.json',actualReceipt),anchorEventId:anchor.event.id,confirmedEventId:confirmed.event.id};
 return{dir,p,c,save};
}
test('s07 binds an actual stored original server verifier receipt to the same Task without inventing a signed/model anchor',async t=>{
 const f=await storedBundle(t);assert.deepEqual(await verifyBundle(f.p,f.dir),[]);
 assert.ok(f.c.refs.every(r=>r.requestId==null&&r.signedVerdict==null));
 assert.equal(f.c.refs.filter(r=>r.role==='stored-original-mcp').length,1);
});
async function changeReceipt(f,mutate){const r=structuredClone(actualReceipt);mutate(r);f.c.storedMcpVerifier.receipt=await f.save('actual-duplicate-receipt.json',r);}
async function changePublic(f,index,mutate){const b=structuredClone(observed.records[index]);mutate(b);const d=await f.save('actual-'+b.event.seq+'.json',b);Object.assign(f.c.refs[index],d);}
test('stored receipt requires the actual successful duplicate, original identity, source and public provenance even after repinning',async t=>{
 const changes=[
 ['HTTP',r=>r.response.httpStatus=503],['rpc error',r=>r.response.rpcError={code:-32000}],['isError',r=>r.response.isError=true],['refusal',r=>r.response.refused='revoked'],['ok',r=>r.response.ok=false],['duplicate missing',r=>delete r.response.command.duplicate],['fresh call',r=>r.response.command.duplicate=false],['verified missing',r=>delete r.response.envelope.verified],['unverified',r=>r.response.envelope.verified=false],
 ['actor',r=>r.publicActorId='different-agent'],['principal',r=>r.originalPrincipal='unrelated-owner'],['command',r=>r.response.command.command_id='unrelated-P0'],['request command',r=>r.request.command_id='other'],['version',r=>r.response.command.world_version++],['expected version',r=>r.response.command.expected_version=828],['tool',r=>r.tool='propose_trade'],['task',r=>r.task_id='different-task'],['answer',r=>r.answer='reject'],['envelope message',r=>r.response.envelope.message_id='other'],['content',r=>r.response.envelope.content_hash='other'],['delegation',r=>r.response.envelope.delegation_ref='other'],['signer',r=>r.response.envelope.signer_kind='muse_client'],['original anchor',r=>r.originalAnchor.inputSeq++],['cached stage',r=>r.response.task.stage='confirm'],['revision',r=>r.response.task.revision++],
 ['source',r=>r.sourceSHA='0'.repeat(40)],['deployment',r=>r.deployId='other'],['worker',r=>r.workerVersion='other'],['provenance',r=>r.classification='real Muse signed cryptographic verification'],['private body',r=>r.fullResponseStored=true],['credential artifact',r=>r.credentialStoredInPublicArtifact=true],['origin',r=>r.request.origin='https://other.invalid'],['path',r=>r.request.path='/api/owner/inbox'],['method',r=>r.request.method='GET'],['time',r=>r.finishedAt=r.performedAt-1]
 ];
 for(const[name,mutate]of changes){const f=await storedBundle(t);await changeReceipt(f,mutate);assert.ok((await verifyBundle(f.p,f.dir)).some(e=>e.startsWith('s07:stored_mcp:')),name);}
});
test('stored original receipt cannot authorize altered public commands, unrelated owner decisions or a different checkpoint',async t=>{
 const changes=[
 ['command kind',0,b=>b.input.kind='external'],['command failure',0,b=>b.input.input.ok=false],['actor',0,b=>b.input.input.actorId='other'],['command id',0,b=>b.input.input.commandId='other'],['action',0,b=>b.input.input.action='propose_meetup'],['payload hash',0,b=>b.input.input.payloadHash='other'],['payload task',0,b=>b.input.input.fields.task_id='other'],['omitted fields',0,b=>b.input.input.omitted=['private']],['envelope scope',0,b=>b.event.data.envelope.scope='trade'],['event kind',0,b=>b.event.kind='a2a_verified'],['invented model',0,b=>b.event.data.evidence={requestId:'FAKE-PROVIDER'}],['run join',0,b=>b.event.runId='other'],['input join',0,b=>b.event.inputSeq++],['snapshot hash',0,b=>b.input.afterSnapshot.body+=' '],['version',0,b=>b.input.versionAfter++],['incompatible',0,b=>b.run.engineVersion='other'],
 ['owner task',1,b=>b.input.input.fields.taskId='unrelated-P0'],['owner approval ref',1,b=>b.event.data.approval_ref='different'],['owner approve',1,b=>b.input.input.fields.decision='reject'],['one owner twice',2,b=>{b.event.muse='00-jolly';b.input.input.fields.museId='00-jolly';}],['owner signed',1,b=>b.event.data.envelope={verified:true}],['confirmation refs',3,b=>b.event.data.approval_refs=['ap_i','unrelated']],['confirmation decision',3,b=>b.input.input.fields.decision='reject'],['confirmation task',3,b=>b.event.data.task_id='other'],['no reward',3,b=>b.event.data.granted=null]
 ];
 for(const[name,index,mutate]of changes){const f=await storedBundle(t);await changePublic(f,index,mutate);assert.ok((await verifyBundle(f.p,f.dir)).some(e=>e.startsWith('s07:')),name);}
 const cases=[['s07 only',f=>f.c.id='s09'],['role support',f=>f.c.refs[0].role='support'],['fake model',f=>f.c.refs[0].requestId='invented'],['fake a2a verdict',f=>f.c.refs[0].signedVerdict='verified'],['missing owner',f=>f.c.refs.splice(1,1)],['receipt hash',f=>f.c.storedMcpVerifier.receipt.sha256='0'.repeat(64)],['missing label',f=>delete f.c.storedMcpVerifier.label],['provenance',f=>delete f.c.storedMcpVerifier.provenance],['checkpoint',f=>f.c.snapshotHash='0'.repeat(64)],['seek before confirmation',f=>f.c.seekSec=0],['tooling missing',f=>delete f.p.tooling],['worker missing',f=>delete f.p.release.workerVersion]];
 for(const[name,mutate]of cases){const f=await storedBundle(t);mutate(f);assert.ok((await verifyBundle(f.p,f.dir)).length,name);}
});
test('ordinary signed/model anchors remain separate from stored server verification',()=>{
 const b=observed.records[0],r={eventId:b.event.id,runId:b.runId,inputSeq:b.input.seq,originalSource:b.event.source,signedVerdict:'verified'},x=structuredClone(b);x.event.kind='a2a_verified';x.event.data.steps=['signature','delegation','scope','replay'];
 assert.equal(signedVerdict(x.event),'verified');assert.deepEqual(validateReference(r,x),[]);
 assert.equal(signedVerdict(b.event),null);assert.ok(validateReference(r,b).includes('model_request_or_signed_verdict_required'));
});

import {Script} from 'node:vm';
import {installControlledLabel,readControlledLabel} from './lib/controlled-label.mjs';
test('capture annotation uses the top layer and rejects an occluding evidence backdrop even with visible CSS',()=>{
 let node,top,interval,mutation,shows=0;const blocker={name:'evidence backdrop'},expected={text:'REPLAY | STORED ORIGINAL SERVER VERIFICATION | OPERATOR MCP',sourceSha:'a'.repeat(40),variant:'s07'};
 const sandbox={window:{innerWidth:1920,innerHeight:960},document:{createElement(tag){if(tag==='style')return{style:{},isConnected:false,textContent:'',remove(){this.isConnected=false;}};return node={style:{},isConnected:false,textContent:'',getBoundingClientRect:()=>({left:12,top:8,right:1908,bottom:68,width:1896,height:60}),showPopover(){shows++;top=this;},remove(){this.isConnected=false;}};},elementsFromPoint:()=>[top],body:{append(n){n.isConnected=true;top=n;}}},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),MutationObserver:class{constructor(fn){mutation=fn;}observe(){}disconnect(){}},setInterval(fn){interval=fn;return 1;},clearInterval(){}};
 new Script('('+installControlledLabel.toString()+')('+JSON.stringify(expected)+')').runInNewContext(sandbox);const read=()=>new Script('('+readControlledLabel.toString()+')()').runInNewContext(sandbox);
 assert.equal(read().valid,true);assert.equal(shows,1);assert.equal(node.popover,'manual');assert.equal(node.style.pointerEvents,'none');
 top=blocker;mutation();interval();assert.equal(read().visible,false);top=node;assert.equal(read().visible,true);assert.equal(read().valid,false,'occlusion cannot be erased by later restoration');
});
test('annotation hit-testing does not schedule its own observer forever',()=>{
 let node,observing=false,selfMutations=0;const sandbox={window:{innerWidth:1920,innerHeight:960},document:{elementsFromPoint:()=>[node],createElement(tag){if(tag==='style')return{style:{},isConnected:false,textContent:'',remove(){this.isConnected=false;}};return node={style:new Proxy({},{set(o,k,v){if(observing&&k==='pointerEvents')selfMutations++;o[k]=v;return true;}}),showPopover(){},isConnected:false,textContent:'',getBoundingClientRect:()=>({left:12,top:8,right:1908,bottom:68,width:1896,height:60}),remove(){}};},body:{append(n){n.isConnected=true;}}},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),MutationObserver:class{observe(){observing=true;}disconnect(){observing=false;}},setInterval(){return 1;},clearInterval(){}};
 new Script('('+installControlledLabel.toString()+')('+JSON.stringify({text:'REPLAY',sourceSha:'a'.repeat(40),variant:'s07'})+')').runInNewContext(sandbox);
 for(let i=0;i<3;i++)new Script('('+readControlledLabel.toString()+')()').runInNewContext(sandbox);
 assert.equal(selfMutations,0);assert.equal(observing,true);
});

import {storedMcpLabelFor,storedMcpBinding} from './lib/stored-mcp.mjs';
import {verifyMedia} from './lib/demo-video.mjs';
test('stored server verifier media binds its actual receipt hash and continuous truthful provenance',async t=>{
 const f=await storedBundle(t),{p,c,dir}=f,refs=c.refs,view={id:'main',runId:refs[0].runId,duration:c.duration,seekSec:c.seekSec,snapshotHash:c.snapshotHash};
 const file='OFFLINE-NOT-FOOTAGE',bytes=Buffer.from('OFFLINE UNIT TEST NOT VIDEO'),receiptFile='OFFLINE-capture-receipt.json';await writeFile(join(dir,file),bytes);
 const label={...storedMcpLabelFor(p),valid:true,visible:true};
 const r={schema:'musely-demo-capture-2',kind:'recorded_public_capture',cutId:'s07',viewId:'main',takeId:'OFFLINE-TAKE',runId:view.runId,durationSeconds:view.duration,seekSec:view.seekSec,release:p.release,tooling:p.tooling,storedMcpVerifier:storedMcpBinding(c),storedMcpLabel:label,label:'REPLAY',virtual:true,originalSources:['live'],startOffsetSec:0,blockedRequests:0,refs,observed:{runId:view.runId,hash:view.snapshotHash,label:true},media:{file,bytes:bytes.length,sha256:sha(bytes)}};
 await writeFile(join(dir,receiptFile),JSON.stringify(r));c.media=[{file,receipt:receiptFile,sha256:sha(bytes),viewId:'main',takeId:r.takeId,runId:view.runId,duration:view.duration,refs}];
 const single={...p,cuts:[c]};assert.equal((await verifyMedia(single,dir)).length,1);
 for(const mutate of[x=>delete x.storedMcpVerifier,x=>x.storedMcpVerifier.receipt.sha256='0'.repeat(64),x=>x.storedMcpLabel.valid=false,x=>x.storedMcpLabel.visible=false,x=>x.storedMcpLabel.text='signed cryptographic verification',x=>x.storedMcpLabel.sourceSha='0'.repeat(40),x=>x.storedMcpLabel.variant='s05',x=>x.tooling.sourceSha='0'.repeat(40)]){const next=structuredClone(r);mutate(next);await writeFile(join(dir,receiptFile),JSON.stringify(next));await assert.rejects(()=>verifyMedia(single,dir),/stored_mcp_capture_binding|tooling_capture_binding/);}
 assert.ok(label.text.includes('OPERATOR MCP'));assert.ok(label.text.includes('NO MODEL CALL'));assert.ok(label.text.includes('NOT INDEPENDENT CRYPTO VERIFICATION'));
});

import {captureDemoCut} from './demo-capture.mjs';
test('offline capture preserves stored-server provenance and rejects a later top-layer occlusion',async t=>{
 for(const occlude of[false,true]){
  const f=await storedBundle(t),{c,p,dir}=f,html='OFFLINE FROZEN HTML NOT PRODUCT';p.release.htmlSha256=sha(html);p.cuts[0].duration+=c.duration-1/16;c.duration=1/16;
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(html);t.after(()=>{globalThis.fetch=originalFetch;});
  let videoPath,node,top;const blocker={},sandbox={window:{innerWidth:1920,innerHeight:960},document:{createElement(tag){if(tag==='style')return{style:{},isConnected:false,textContent:'',remove(){this.isConnected=false;}};return node={style:{},isConnected:false,textContent:'',showPopover(){top=this;},remove(){this.isConnected=false;},getBoundingClientRect:()=>({left:12,top:8,right:1908,bottom:68,width:1896,height:60})};},elementsFromPoint:()=>[top],body:{append(n){n.isConnected=true;}}},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),MutationObserver:class{observe(){}disconnect(){}},setInterval(){return 1;},clearInterval(){}};
  const root={getByRole:(_,{name})=>({click:async()=>{if(name==='Play recorded run'&&occlude)top=blocker;}}),locator:()=>({fill:async()=>{},dispatchEvent:async()=>{},selectOption:async()=>{}}),evaluate:async()=>({runId:c.refs[0].runId,hash:c.snapshotHash,label:true})};
  const page={video:()=>({path:async()=>videoPath}),goto:async()=>{},waitForFunction:async()=>{},locator:()=>root,evaluate:async(fn,arg)=>{if(fn===installControlledLabel)return new Script('('+fn.toString()+')('+JSON.stringify(arg)+')').runInNewContext(sandbox);if(fn===readControlledLabel)return new Script('('+fn.toString()+')()').runInNewContext(sandbox);if(fn.toString().includes('projection.events'))return c.refs.map(r=>r.eventId);}};
  const browser={newContext:async options=>{videoPath=join(options.recordVideo.dir,'OFFLINE-NOT-FOOTAGE');await writeFile(videoPath,'OFFLINE MOCK BYTES');return{route:async()=>{},newPage:async()=>page,close:async()=>{}};}};
  if(occlude)await assert.rejects(()=>captureDemoCut(browser,p,'s07',dir),/provenance_label_lost/);
  else{const media=await captureDemoCut(browser,p,'s07',dir),receipt=JSON.parse(await readFile(join(dir,media.receipt),'utf8'));assert.deepEqual(receipt.storedMcpVerifier,c.storedMcpVerifier);assert.equal(receipt.storedMcpLabel.visible,true);assert.equal(receipt.storedMcpLabel.valid,true);c.media=[media];assert.equal((await verifyMedia({...p,cuts:[c]},dir)).length,1);}
  globalThis.fetch=originalFetch;
 }
});
test('stored verification burn-in remains readable in three lines without claiming a Meta model call',async t=>{
 const {captionFor}=await import('./lib/demo-video.mjs'),f=await storedBundle(t),caption=captionFor(f.p,f.c,{originalSources:['live']});
 assert.equal(caption.split('\n').length,3);assert.ok(caption.split('\n').every(line=>line.length<=100));assert.ok(caption.includes('STORED ORIGINAL SERVER VERIFICATION | OPERATOR MCP'));assert.ok(caption.includes('NO MODEL CALL | NOT INDEPENDENT CRYPTO VERIFICATION'));assert.ok(!caption.includes('Meta Muse Spark'));
});
test('confirmation and final owner support must reference the very same committed external input',async t=>{
 for(const mutate of[b=>b.input.input.fields.museId='00-jolly',b=>{b.input.seq++;b.event.inputSeq++;}]){const f=await storedBundle(t);await changePublic(f,3,mutate);if(f.c.refs[3].inputSeq!==JSON.parse(await readFile(join(f.dir,f.c.refs[3].file),'utf8')).input.seq)f.c.refs[3].inputSeq++;assert.ok((await verifyBundle(f.p,f.dir)).some(e=>e.startsWith('s07:stored_mcp:')));}
});
test('annotation isolates its width and backdrop from product-wide popover styling',()=>{
 let node,sheet;const sandbox={window:{innerWidth:1920,innerHeight:960},document:{createElement(tag){if(tag==='style')return sheet={textContent:'',remove(){}};return node={style:{},showPopover(){},isConnected:false,textContent:'',getBoundingClientRect:()=>({left:12,top:8,right:1908,bottom:68,width:1896,height:60}),remove(){}};},elementsFromPoint:()=>[node],body:{append(n){n.isConnected=true;}}},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),MutationObserver:class{observe(){}disconnect(){}},setInterval(){return 1;},clearInterval(){}};
 new Script('('+installControlledLabel.toString()+')('+JSON.stringify({text:'REPLAY',sourceSha:'a'.repeat(40),variant:'s07'})+')').runInNewContext(sandbox);
 assert.equal(node.style.width,'auto');assert.ok(sheet.textContent.includes('#d05-filming-provenance::backdrop'));assert.ok(sheet.textContent.includes('backdrop-filter:none'));assert.ok(sheet.textContent.includes('background:transparent'));
 const read=()=>new Script('('+readControlledLabel.toString()+')()').runInNewContext(sandbox);assert.equal(read().valid,true);sheet.isConnected=false;assert.equal(read().valid,false);sheet.isConnected=true;assert.equal(read().visible,true);assert.equal(read().valid,false);
});
