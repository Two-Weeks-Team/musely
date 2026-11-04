// Private owner preference. Shared WorldDO wiring supplies verified current ownership, never client actor claims.
import {isSocialMode,publicAvailability,type SocialMode,type SocialStatus} from '../../src/engine/social-status.ts';
import type {WorldState} from '../../src/engine/world.ts';
import type {PersonalStorage} from './personal-owners.ts';
export type OwnSocialStatus={muse:string;mode:SocialMode;revision:number;status:SocialStatus};
type Code='social_status_forbidden'|'invalid_social_status'|'social_status_conflict'|'social_status_unavailable';
export class SocialStatusError extends Error {
 readonly code:Code;
 constructor(code:Code){super(code);this.name='SocialStatusError';this.code=code;}
}
const fail=(code:Code):never=>{throw new SocialStatusError(code);};
export class SocialStatusStore<Binding> {
 private storage:PersonalStorage;
 private options:{world:()=>WorldState;authorize:(binding:Binding,muse:string,now:number)=>boolean;now?:()=>number};
 constructor(storage:PersonalStorage,options:SocialStatusStore<Binding>['options']){this.storage=storage;this.options=options;}
 init(){this.storage.sql.exec("CREATE TABLE IF NOT EXISTS social_status_overrides (world_id TEXT NOT NULL,actor_id TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('auto','welcoming','busy','do_not_disturb')),revision INTEGER NOT NULL CHECK(revision>=1),PRIMARY KEY(world_id,actor_id))");}
 private now(){return(this.options.now??Date.now)();}
 private guard(binding:Binding,muse:string){const now=this.now(),world=this.options.world();if(!Number.isSafeInteger(now)||now<0||!world.muses.some(m=>m.id===muse)||this.options.authorize(binding,muse,now)!==true)return fail('social_status_forbidden');return world;}
 private read(worldId:string,muse:string):{mode:SocialMode;revision:number}{
  const row=this.storage.sql.exec('SELECT mode,revision FROM social_status_overrides WHERE world_id=? AND actor_id=?',worldId,muse).toArray()[0];
  if(!row)return{mode:'auto',revision:0};
  if(!isSocialMode(row.mode)||!Number.isSafeInteger(row.revision)||Number(row.revision)<1)return fail('social_status_unavailable');
  return{mode:row.mode,revision:Number(row.revision)};
 }
 /** Internal sync seam; normal browser reads must use get with verified ownership. */
 override(muse:string):SocialMode {const world=this.options.world();if(!world.muses.some(m=>m.id===muse))return 'do_not_disturb';return this.read(world.worldId,muse).mode;}
 /** Trusted deletion adapter only, called inside the caller's actor-deletion transaction. No HTTP endpoint. */
 purgeInTransaction(muse:string):void {this.storage.sql.exec('DELETE FROM social_status_overrides WHERE world_id=? AND actor_id=?',this.options.world().worldId,muse);}
 public(muse:string):{status:SocialStatus}{try{const world=this.options.world();return publicAvailability(world,muse,this.now(),this.read(world.worldId,muse).mode);}catch{return{status:'do_not_disturb'};}}
 get(binding:Binding,muse:string):OwnSocialStatus {const world=this.guard(binding,muse),row=this.read(world.worldId,muse);return{muse,...row,...publicAvailability(world,muse,this.now(),row.mode)};}
 set(binding:Binding,muse:string,input:unknown):OwnSocialStatus {
  this.guard(binding,muse);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='expectedRevision,mode')return fail('invalid_social_status');
  const x=input as {mode:unknown;expectedRevision:unknown};const mode=x.mode,expected=x.expectedRevision;
  if(!isSocialMode(mode)||typeof expected!=='number'||!Number.isSafeInteger(expected)||expected<0||expected>=Number.MAX_SAFE_INTEGER)return fail('invalid_social_status');
  return this.storage.transactionSync(()=>{
   const world=this.guard(binding,muse),row=this.read(world.worldId,muse);
   if(row.revision!==expected)return fail('social_status_conflict');
   const revision=row.revision+1;
   this.storage.sql.exec('INSERT INTO social_status_overrides (world_id,actor_id,mode,revision) VALUES (?,?,?,?) ON CONFLICT(world_id,actor_id) DO UPDATE SET mode=excluded.mode,revision=excluded.revision',world.worldId,muse,mode,revision);
   return{muse,mode,revision,...publicAvailability(world,muse,this.now(),mode)};
  });
 }
}
