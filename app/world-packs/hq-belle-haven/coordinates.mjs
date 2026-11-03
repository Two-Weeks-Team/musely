// Independent authoring contract. Does not alter the runtime Place catalog.
export const ORIGIN = Object.freeze([-122.14991969950646, 37.48313116566372]);
const latScale = 111320, lngScale = latScale * Math.cos(ORIGIN[1] * Math.PI / 180);
function finitePair(a,b) { if (!Number.isFinite(a)||!Number.isFinite(b)) throw new TypeError('Finite coordinate required'); }
export function toLocal(lng,lat) {
  finitePair(lng,lat);
  if (Math.abs(lng)>180 || Math.abs(lat)>90) throw new RangeError('Invalid WGS84');
  const x=(lng-ORIGIN[0])*lngScale, z=-(lat-ORIGIN[1])*latScale;
  if (Math.hypot(x,z)>5000) throw new RangeError('Outside local authoring extent');
  return {x,z};
}
export function toWgs84(x,z) { finitePair(x,z); if(Math.hypot(x,z)>5000) throw new RangeError('Outside local authoring extent'); return [ORIGIN[0]+x/lngScale,ORIGIN[1]-z/latScale]; }
// Authored commons grid only; geographic geometry MUST NOT receive this rotation.
export function gridToLocal(x,z,bearingDeg=30) { finitePair(x,z); if(!Number.isFinite(bearingDeg)) throw new TypeError('Finite bearing required'); const a=bearingDeg*Math.PI/180; return {x:x*Math.cos(a)-z*Math.sin(a),z:x*Math.sin(a)+z*Math.cos(a)}; }
