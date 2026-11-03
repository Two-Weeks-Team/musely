import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {mountArrivalOverview}=await import('../src/arrival-overview.ts').catch(()=>({}));
const OVERVIEW_URL='/assets/arrival-overview.'+'a'.repeat(64)+'.json';
const DATA={type:'FeatureCollection',features:[{type:'Feature',properties:{kind:'water'},geometry:{type:'Polygon',coordinates:[]}}]};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function mapStub(zoom=21.2){const handlers=new Map(),sets=[];let source;
 const map={getZoom:()=>zoom,getSource:()=>source,on:(name,fn)=>{const list=handlers.get(name)??new Set();list.add(fn);handlers.set(name,list);},off:(name,fn)=>handlers.get(name)?.delete(fn)};
 return{map,sets,handlers,zoom:z=>{zoom=z;for(const fn of handlers.get('zoom')??[])fn();},styleReady:()=>{source={setData:data=>sets.push(data)};for(const fn of handlers.get('style.load')??[])fn();},load:()=>{source={setData:data=>sets.push(data)};for(const fn of handlers.get('load')??[])fn();},remove:()=>{for(const fn of [...handlers.get('remove')??[]])fn();}};
}
function mount(map,descriptor,options){assert.equal(typeof mountArrivalOverview,'function','lazy overview controller exists');return mountArrivalOverview(map,descriptor,options);}
test('ordinary HQ load does not request or parse the hidden overview; zooming wide fetches once',async()=>{
 const m=mapStub();let calls=0,parses=0;
 mount(m.map,{url:OVERVIEW_URL,data:null},{fetcher:async(url,init)=>{calls++;assert.equal(url,OVERVIEW_URL);assert.equal(init.credentials,'omit');return{ok:true,json:async()=>{parses++;return DATA;}};}});
 m.load();m.zoom(21.2);m.zoom(14);await flush();assert.equal(calls,0);assert.equal(parses,0);assert.equal(m.sets.length,0);
 m.zoom(13.99);await flush();assert.equal(calls,1);assert.equal(parses,1);assert.deepEqual(m.sets,[DATA]);m.zoom(10.25);m.zoom(21.2);m.zoom(9.6);await flush();assert.equal(calls,1);assert.equal(m.sets.length,1);
});
test('initial wide story/entryPreview waits for source then fetches and restores original data',async()=>{
 for(const zoom of [9.6,10.25]){const m=mapStub(zoom);let calls=0;mount(m.map,{url:OVERVIEW_URL,data:null},{fetcher:async()=>{calls++;return{ok:true,json:async()=>DATA};}});await flush();assert.equal(calls,0);m.load();await flush();assert.equal(calls,1);assert.equal(m.sets[0],DATA);}
});
test('style-ready starts wide overview before unrelated online tiles load while HQ remains request-free',async()=>{
 for(const zoom of [10.25,21.2]){const m=mapStub(zoom);let calls=0;mount(m.map,{url:OVERVIEW_URL,data:null},{fetcher:async()=>{calls++;return{ok:true,json:async()=>DATA};}});m.styleReady();await flush();assert.equal(calls,zoom<14?1:0);assert.equal(m.sets.length,zoom<14?1:0);m.remove();assert.ok([...m.handlers.values()].every(s=>s.size===0));}
});
test('in-flight repeated zoom and late near return share one fetch; next wide uses cache',async()=>{
 const m=mapStub(10.25);let resolve,calls=0;const held=new Promise(r=>resolve=r);
 mount(m.map,{url:OVERVIEW_URL,data:null},{fetcher:async()=>{calls++;return held;}});m.load();m.zoom(10);m.zoom(11);m.zoom(21.2);await flush();assert.equal(calls,1);resolve({ok:true,json:async()=>DATA});await flush();assert.equal(m.sets.length,0);m.zoom(10);await flush();assert.deepEqual(m.sets,[DATA]);assert.equal(calls,1);
});
test('HTTP/parse/shape/network failure leaves existing fallback and reports once without automatic retry',async()=>{
 for(const fail of ['http','parse','shape','network']){const m=mapStub(10);let calls=0,errors=0;const c=mount(m.map,{url:OVERVIEW_URL,data:null},{fetcher:async()=>{calls++;if(fail==='network')throw Error('offline');return{ok:fail!=='http',json:async()=>{if(fail==='parse')throw Error('invalid JSON');return fail==='shape'?{type:'FeatureCollection'}:DATA;}};},onError:()=>errors++});m.load();await flush();m.zoom(11);m.zoom(21);m.zoom(10);await flush();assert.equal(calls,1,fail);assert.equal(m.sets.length,0,fail);assert.equal(errors,1,fail);assert.equal(c.state(),'failed');}
});
test('remove cancels only own request and fences late data/error callbacks',async()=>{
 for(const error of [false,true]){const m=mapStub(10);let resolve,reject,signal,errors=0;const held=new Promise((r,j)=>{resolve=r;reject=j;});const c=mount(m.map,{url:OVERVIEW_URL,data:null},{fetcher:async(_url,init)=>{signal=init.signal;return held;},onError:()=>errors++});m.load();await flush();m.remove();assert.equal(signal.aborted,true);if(error)reject(Error('late'));else resolve({ok:true,json:async()=>DATA});await flush();assert.equal(m.sets.length,0);assert.equal(errors,0);assert.equal(c.state(),'disposed');assert.ok([...m.handlers.values()].every(s=>s.size===0));}
});
test('inline local proof uses its original overview without external request',async()=>{
 const m=mapStub(9.6);let calls=0;mount(m.map,{url:'',data:DATA},{fetcher:async()=>calls++});m.load();await flush();assert.equal(calls,0);assert.equal(m.sets[0],DATA);m.zoom(10);await flush();assert.equal(m.sets.length,1);
});
test('descriptor rejects a non-hash or private URL without making a request',async()=>{
 for(const url of ['/api/owner/location','https://other.example/overview.json','/assets/arrival-overview.json',OVERVIEW_URL+'?x=1']){const m=mapStub(10);let calls=0,errors=0;mount(m.map,{url,data:null},{fetcher:async()=>calls++,onError:()=>errors++});m.load();await flush();assert.equal(calls,0);assert.equal(errors,1);assert.equal(m.sets.length,0);}
});
test('main uses empty initial source and lazy controller rather than static geometry import',async()=>{
 const text=await readFile(new URL('../src/main.ts',import.meta.url),'utf8');assert.ok(!text.includes("import arrivalMap from '../assets/arrival-map.json'"));assert.match(text,/mountArrivalOverview\(map/);assert.match(text,/data:\{type:'FeatureCollection',features:\[\]\}/);
});
