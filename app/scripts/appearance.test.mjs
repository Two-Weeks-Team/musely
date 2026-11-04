// Cosmetic domain only: no network, renderer, provider, account or runtime authority.
import test from 'node:test';import assert from 'node:assert/strict';
import {MUSE_VARIANTS} from '../src/character-kit/catalog.ts';
import {BODY_PALETTE,ACCENT_PALETTE,DECOS,normalizeAppearance,isAppearance,defaultAppearance,resolveAppearance,appearanceLook,appearanceKey,encodeAppearance,decodeAppearance} from '../src/character-kit/appearance.ts';
import {actorProfile,admitPersonal} from '../src/engine/participants.ts';import {createWorld} from '../src/engine/world.ts';import {snapshotBody} from '../worker/core/run-log.ts';
const CUSTOM={look:'03-ripple',body:'sage',accent:'04-ember',deco:'06-ink'};
test('all ten legacy strings retain exact stored values and original body/accent/deco presentation',()=>{
 assert.equal(BODY_PALETTE.length,12);assert.equal(ACCENT_PALETTE.length,10);assert.equal(DECOS.length,10);
 for(const v of MUSE_VARIANTS){assert.equal(normalizeAppearance(v.id),v.id);assert.equal(encodeAppearance(v.id),v.id);assert.equal(decodeAppearance(v.id),v.id);const resolved=resolveAppearance(v.id);assert.equal(resolved.look,v.id);assert.equal(resolved.bodyHex,v.body);assert.equal(resolved.accentHex,v.accent);assert.equal(resolved.deco,v.id==='00-jolly'?'none':v.id);assert.deepEqual(resolveAppearance(defaultAppearance(v.id)),resolved);}
});
test('body, accent and deco are independent bounded choices; object order and caller mutation cannot change normalized data',()=>{
 const original={...CUSTOM},value=normalizeAppearance(original);assert.notEqual(value,original);original.body='invalid';assert.equal(value.body,'sage');assert.equal(appearanceLook(value),'03-ripple');assert.equal(resolveAppearance(value).bodyHex,'#9AAE91');assert.equal(resolveAppearance(value).accentHex,'#E6BE77');
 assert.equal(appearanceKey({deco:'06-ink',accent:'04-ember',body:'sage',look:'03-ripple'}),appearanceKey(CUSTOM));assert.deepEqual(decodeAppearance(encodeAppearance(CUSTOM)),CUSTOM);
 assert.deepEqual(normalizeAppearance({...CUSTOM,look:'00-jolly',deco:'09-copper'}),{look:'00-jolly',body:'sage',accent:'04-ember',deco:'09-copper'});
});
test('raw colors, asset URLs, unknown IDs/fields, arrays and serialized request objects are rejected',()=>{
 for(const value of[null,[],{},42,'unknown',JSON.stringify(CUSTOM),{...CUSTOM,look:'10-judge'},{...CUSTOM,body:'#9AAE91'},{...CUSTOM,accent:'wheat'},{...CUSTOM,deco:'00-jolly'},{...CUSTOM,deco:'https://outside.invalid/attachment.glb'},{...CUSTOM,privateReason:'PRIVATE_CANARY'},{...CUSTOM,body:{hex:'#9AAE91'}}]){assert.equal(isAppearance(value),false);assert.throws(()=>normalizeAppearance(value),/invalid_appearance/);}
 assert.throws(()=>decodeAppearance('{"look":"03-ripple","body":"PRIVATE_CANARY"}'),/invalid_appearance/);
});
test('custom public profile keeps exactly four fields; allowlisted snapshot preserves the spec and old profiles remain byte-identical',()=>{
 const old={actorId:'pm_11111111-1111-4111-8111-111111111111',displayName:'Literal name',appearanceId:'00-jolly',revision:1};assert.equal(JSON.stringify(actorProfile(old,old.actorId)),JSON.stringify(old));
 const profile={...old,appearanceId:CUSTOM},world=createWorld('appearance',Date.parse('2026-11-04T20:00:00Z'));const original=JSON.stringify(world.muses);assert.equal(admitPersonal(world,profile,world.lastTickAt),true);assert.deepEqual(world.muses.slice(0,-1),JSON.parse(original));assert.equal(world.muses.at(-1).controlMode,'personal');assert.deepEqual(Object.keys(world.muses.at(-1).profile),['actorId','displayName','appearanceId','revision']);
 const state=JSON.parse(snapshotBody(world));assert.deepEqual(state.muses.at(-1).profile.appearanceId,CUSTOM);assert.equal(state.muses.at(-1).profile.displayName,'Literal name');
 world.muses.at(-1).profile.appearanceId={...CUSTOM,privateReason:'PRIVATE_CANARY'};assert.ok(!snapshotBody(world).includes('PRIVATE_CANARY'),'nested projection cannot spread unknown appearance fields');assert.throws(()=>actorProfile(world.muses.at(-1).profile,old.actorId),/invalid_actor_profile/);
});
