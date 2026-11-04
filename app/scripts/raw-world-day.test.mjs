// Real runtime/SQLite and Worker routing. No provider, production data, browser or account calls.
import test from 'node:test';import assert from 'node:assert/strict';import{DatabaseSync}from'node:sqlite';
import{WorldRuntime}from'../worker/core/world-runtime.ts';import{loadRun}from'../src/replay/player.ts';
const BEFORE=Date.parse('2026-11-04T07:59:30Z'),AT=BEFORE+31000,OLD='2026-11-03',DAY='2026-11-04';
function fixture(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());let depth=0;const sql={exec(q,...b){const s=db.prepare(q),a=s.columns().length?s.all(...b):(s.run(...b),[]);return{toArray:()=>a};},transactionSync(fn){const id='t'+depth++;db.exec('SAVEPOINT '+id);try{const v=fn();db.exec('RELEASE '+id);return v;}catch(e){db.exec('ROLLBACK TO '+id);db.exec('RELEASE '+id);throw e;}finally{depth--;}}};
 const rt=new WorldRuntime(sql,{worldId:'day-fixture',model:null,meetingGate:'off',perception:{enabled:true},publicationNow:()=>AT});rt.init(BEFORE);
 const commit=(at,label,day,place)=>rt.commitExternal(at,label,(s,emit)=>{if(day)s.day=day;s.muses.find(m=>m.id==='01-sunny').place=place;emit({at,source:'rule',kind:'greet',muse:'01-sunny',line:label,data:{public:true},tags:['greeting']});emit({at,source:'rule',kind:'cards_verified',muse:'01-sunny',data:{},tags:['system']});});
 // The old world day persists just past local midnight until the next world update.
 commit(BEFORE+1000,'initial-perception-baseline',null,'commons:campfire');commit(AT,'before-world-day-tick',null,'commons:garden');commit(AT+1000,'new-world-day',DAY,'commons:cafe');
 const raw=rt.events(0,10000),inputDay=e=>rt.runLog.input(e.inputSeq).day;assert.ok(raw.some(e=>e.kind==='perception_notice'&&e.id.startsWith('run-')),'actual derived perception IDs reproduce the report');assert.equal(raw.find(e=>e.line==='before-world-day-tick').id.startsWith(OLD),true);
 return{db,sql,rt,raw,inputDay};}
test('raw day includes actual run-prefixed perception by stored world day across midnight and paginates without gaps',t=>{
 const{rt,raw,inputDay}=fixture(t),before=JSON.stringify(raw);for(const day of[OLD,DAY]){const expected=raw.filter(e=>inputDay(e)===day),all=[];let cursor=0;for(;;){const page=rt.events(cursor,2,{day});all.push(...page);if(page.length<2)break;cursor=page.at(-1).seq;}assert.deepEqual(all,expected);assert.ok(all.some(e=>e.kind==='perception_notice'));}
 assert.deepEqual(rt.events(0,10000,{runId:rt.runLog.current.runId}),raw);assert.deepEqual(rt.events(0,10000,{day:'2026-11-05'}),[]);assert.equal(JSON.stringify(rt.events(0,10000)),before);
 const run=rt.runLog.current,record={...run,inputs:rt.runLog.inputs(run.runId,0,100),events:raw,readThrough:rt.runLog.boundary(run.runId)},player=loadRun(record);player.seek(Number.MAX_SAFE_INTEGER);assert.equal(player.getFrame().snapshotHash,record.inputs.at(-1).afterHash);
});
test('autonomy day uses the same supplement with indexed time bounds and exact adjacent-day exclusion',t=>{
 const{rt,sql,raw,inputDay}=fixture(t);for(const day of[OLD,DAY]){const q=rt.autonomyQuery({day},AT+2000),sample=sql.exec(q.sql,...q.params).toArray();assert.deepEqual(sample.map(e=>e.id),raw.filter(e=>inputDay(e)===day).map(e=>e.id));assert.equal(rt.autonomy({day},AT+2000).sample.events,sample.length);const plan=sql.exec('EXPLAIN QUERY PLAN '+q.sql,...q.params).toArray().map(r=>r.detail).join(' ');assert.match(plan,/SEARCH events USING INDEX events_at/);}
});
test('supplement requires perception kind and exact run/input/day while every original day-ID row stays included',t=>{
 const{db,rt,raw}=fixture(t),ref=raw.find(e=>e.kind==='perception_notice'&&rt.runLog.input(e.inputSeq).day===DAY),insert=db.prepare('INSERT INTO events(id,tick,at,source,kind,muse,data,tags,run_id,input_seq) VALUES(?,0,?,\'rule\',?,\'01-sunny\',\'{}\',\'[]\',?,?)');
 for(const[id,kind,run,input]of[['run:wrong-run','perception_notice','wrong-run',ref.inputSeq],['run:wrong-input','perception_notice',ref.runId,999999],['run:no-input','perception_notice',ref.runId,null],['run:ordinary','greet',ref.runId,ref.inputSeq],[DAY+':legacy','greet',null,null],[DAY+':old-run-row','greet',ref.runId,null]])insert.run(id,AT+1000,kind,run,input);
 const matches=rt.events(0,10000,{day:DAY}).map(e=>e.id);for(const id of['run:wrong-run','run:wrong-input','run:no-input','run:ordinary'])assert.ok(!matches.includes(id),id);for(const id of[ref.id,DAY+':legacy',DAY+':old-run-row'])assert.ok(matches.includes(id),id);
 const q=rt.autonomyQuery({day:DAY},AT+2000),autonomy=db.prepare(q.sql).all(...q.params).map(e=>e.id);assert.deepEqual(autonomy,matches);
});
test('actual Worker day/run views preserve raw perception while default Feed and Highlights keep hiding system rows',async t=>{
 const{registerHooks}=await import('node:module'),hook=registerHooks({resolve(s,c,n){return s==='cloudflare:workers'?{url:'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}',shortCircuit:true}:n(s,c);}});let worker,WorldDO;try{({default:worker,WorldDO}=await import('../worker/index.ts'));}finally{hook.deregister();}
 const{rt,raw,inputDay}=fixture(t),stub={worldEvents:(...a)=>WorldDO.prototype.worldEvents.call({runtime:rt},...a),worldHighlights:(...a)=>WorldDO.prototype.worldHighlights.call({runtime:rt},...a)},env={PUBLIC_ORIGIN:'https://musely.net',ALLOWED_HOSTS:'musely.net',WORLD:{idFromName:()=> 'world',get:()=>stub}};
 const get=async path=>{const r=await worker.fetch(new Request('https://musely.net'+path),env);assert.equal(r.status,200);return r.json();};
 assert.deepEqual(await get('/api/world/events?day='+DAY+'&limit=2000'),raw.filter(e=>inputDay(e)===DAY));assert.deepEqual(await get('/api/world/events?runId='+rt.runLog.current.runId+'&limit=2000'),raw);
 for(const path of['/api/world/events?limit=2000','/api/world/events?tail=500','/api/world/highlights?limit=100']){const rows=await get(path);assert.ok(rows.length);assert.ok(rows.every(e=>!['perception_notice','cards_verified'].includes(e.kind)));}assert.deepEqual(rt.events(0,10000),raw);
});
