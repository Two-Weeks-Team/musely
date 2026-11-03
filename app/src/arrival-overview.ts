import type {Map as LibreMap,GeoJSONSource} from 'maplibre-gl';
import type {FeatureCollection} from 'geojson';

/** The same overview is inline in the local proof and deferred in the served app. */
export function mountArrivalOverview(map:Pick<LibreMap,'getZoom'|'getSource'|'on'|'off'>,descriptor:{url:string;data:unknown},{fetcher=fetch,onError=()=>{}}:{fetcher?:typeof fetch;onError?:()=>void}={}){
 let status:'idle'|'loading'|'ready'|'failed'|'disposed'='idle',data:FeatureCollection|null=null,applied:GeoJSONSource|undefined;
 const controller=new AbortController();
 const valid=(value:unknown):value is FeatureCollection=>!!value&&typeof value==='object'&&(value as FeatureCollection).type==='FeatureCollection'&&Array.isArray((value as FeatureCollection).features);
 const fail=()=>{if(status==='disposed')return;status='failed';try{onError();}catch{}};
 const apply=()=>{
  if(status==='disposed'||status==='failed'||!(map.getZoom()<14))return;
  const source=map.getSource('arrival-overview') as GeoJSONSource|undefined;
  if(!source)return;
  if(data){if(applied!==source){source.setData(data);applied=source;}return;}
  if(status==='loading')return;
  if(!descriptor.url){if(!valid(descriptor.data)){fail();return;}data=descriptor.data;status='ready';apply();return;}
  if(!/^\/assets\/arrival-overview\.[a-f0-9]{64}\.json$/.test(descriptor.url)){fail();return;}
  status='loading';
  void (async()=>{
   const response=await fetcher(descriptor.url,{credentials:'omit',signal:controller.signal});
   if(controller.signal.aborted)return;
   if(!response.ok)throw Error('overview_unavailable');
   const value:unknown=await response.json();
   if(controller.signal.aborted)return;
   if(!valid(value))throw Error('overview_invalid');
   data=value;status='ready';apply();
  })().catch(fail);
 };
 const update=()=>{try{apply();}catch{fail();}};
 const dispose=()=>{status='disposed';controller.abort();map.off('style.load',update);map.off('load',update);map.off('zoom',update);map.off('remove',dispose);};
 map.on('style.load',update);map.on('load',update);map.on('zoom',update);map.on('remove',dispose);update();
 return{dispose,state:()=>status};
}
