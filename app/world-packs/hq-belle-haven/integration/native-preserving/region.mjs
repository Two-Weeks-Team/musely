import * as maplibre from 'maplibre-gl';
import geography from '../fixtures/app/assets/geography.json' with {type:'json'};
import {placeById} from '../fixtures/app/src/engine/places.ts';
import {frameFor} from '../adapter.mjs';
export const CIRCLE_ENABLED=false;
export const DEFAULT_RADIUS_M=500; // design estimate, adjustable; not user-confirmed
const frame=frameFor(geography),campfire=placeById('commons:campfire');
if(campfire.zone!=='commons')throw Error('Campfire contract changed; review latest main');
export const centerScene=Object.freeze({x:campfire.x,z:campfire.z});
export function sceneToGeo(x,z){const e=x*Math.cos(frame.yaw)-z*Math.sin(frame.yaw),s=x*Math.sin(frame.yaw)+z*Math.cos(frame.yaw);const p=new maplibre.MercatorCoordinate(frame.origin.x+e*frame.unit,frame.origin.y+s*frame.unit,0).toLngLat();return[p.lng,p.lat]}
export const centerLngLat=Object.freeze(sceneToGeo(centerScene.x,centerScene.z));
export function radiusCheck(radius){if(!Number.isFinite(radius)||radius<25||radius>1000)throw Error('Experimental radius must be 25–1000 scene metres');}
export function maxDistance(geoPolygon){return Math.max(...geoPolygon.flat().map(c=>{const p=frame.toScene(...c);return Math.hypot(p.x-centerScene.x,p.z-centerScene.z)}));}
export function classifyBuilding(geoPolygon,radius=DEFAULT_RADIUS_M,margin=2){radiusCheck(radius);if(!Number.isFinite(margin)||margin<0||margin>=radius)throw Error('Invalid margin');const max=maxDistance(geoPolygon);return {eligible:max<=radius-margin,maxRadiusM:max,reason:max<=radius-margin?'whole-geometry-inside':'retain-native-boundary-or-outside',enabled:false};}
export function circleOutline(radius=DEFAULT_RADIUS_M,segments=128){radiusCheck(radius);if(!Number.isInteger(segments)||segments<32||segments>512)throw Error('Invalid segment count');const ring=Array.from({length:segments},(_,i)=>sceneToGeo(centerScene.x+radius*Math.cos(2*Math.PI*i/segments),centerScene.z+radius*Math.sin(2*Math.PI*i/segments)));ring.push(ring[0]);return {type:'Feature',properties:{kind:'diagnostic-boundary',radiusM:radius,enabled:false},geometry:{type:'Polygon',coordinates:[ring]}};}
// Design-only density policy for future authored decoration, NOT opacity/material
// mutation. Existing map stays visible across the entire circle and exterior.
export function decorationWeight(distance,radius=DEFAULT_RADIUS_M,transition=50){radiusCheck(radius);if(!Number.isFinite(distance)||distance<0||!(transition>0&&transition<=radius))throw Error('Invalid radial transition');if(distance>=radius)return 0;if(distance<=radius-transition)return 1;const t=(radius-distance)/transition;return t*t*(3-2*t)}
