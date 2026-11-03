// Explicit personal ownership proof. Separate from login, admission and action delegation.
import {PersonalAuthStore,type PersonalFlow,type PersonalSessionRow} from './personal-session.ts';
import {PersonalRegistryError,type PersonalStorage} from './personal-owners.ts';
import type {PersonalBinding} from './personal-registration.ts';
import {claimFingerprint,claimText,jwkThumbprint,type EcPublicJwk} from '../../src/identity/fingerprint.ts';
import {hex,sha256} from '../../src/identity/jcs.ts';
import {sealClaimToken,openClaimToken,type ClaimCipherBinding} from './personal-claim-cipher.ts';
import {currentPersonalClaim,type PersonalClaimStatus} from './personal-claim-state.ts';
import {verifyPersonalClaim,recheckPersonalClaim,type ClaimProviderConfig} from './personal-claim-provider.ts';

type Config=ClaimProviderConfig&{secret:string;now?:()=>number};
type Context={actorId:string;principalId:string;appId:string;subject:string;agentId:string;rootRef:string;rootJwk:string;version:number;fingerprint:string;display:string};
export type PersonalClaimProjection={actorId:string;status:PersonalClaimStatus;claimed:boolean;version:number;fingerprint:string;display:string;text:string;permalink:string|null;verifiedAt:number|null;checkedAt:number|null};
export type ClaimFlowBinding=Pick<PersonalFlow,'stateDigest'|'browserDigest'|'appId'|'redirectUri'>;
const fail=(code:string):never=>{throw new PersonalRegistryError(code);};
const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const exact=(x:unknown,keys:string)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys;
const cipherBinding=(c:Context,version:number):ClaimCipherBinding=>({actorId:c.actorId,principalId:c.principalId,appId:c.appId,agentId:c.agentId,rootRef:c.rootRef,fingerprint:c.fingerprint,version});
const same=(a:Context,b:Context)=>JSON.stringify(a)===JSON.stringify(b);
const nullableTime=(v:unknown)=>integer(v)?v:null;

export class PersonalClaims{
 private readonly now:()=>number;
 private readonly pending=new Map<string,Promise<void>>();
 private readonly storage:PersonalStorage;private readonly auth:PersonalAuthStore;private readonly cfg:Config;private readonly onLost:(actorId:string,status:PersonalClaimStatus,version:number)=>void;
 constructor(storage:PersonalStorage,auth:PersonalAuthStore,cfg:Config,onLost:(actorId:string,status:PersonalClaimStatus,version:number)=>void=()=>{}){this.storage=storage;this.auth=auth;this.cfg=cfg;this.onLost=onLost;this.now=cfg.now??Date.now;}
 init(){this.storage.transactionSync(()=>{
  this.storage.sql.exec('CREATE TABLE IF NOT EXISTS personal_claims (actor_id TEXT PRIMARY KEY,principal_id TEXT NOT NULL,app_id TEXT NOT NULL,subject TEXT NOT NULL,agent_id TEXT NOT NULL,root_ref TEXT NOT NULL,root_jwk TEXT NOT NULL,fingerprint TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL,verified_at INTEGER,checked_at INTEGER,post_id TEXT,permalink TEXT,token_cipher TEXT,token_expires_at INTEGER)');
  this.storage.sql.exec('CREATE TABLE IF NOT EXISTS personal_claim_flows (state_digest TEXT PRIMARY KEY,browser_digest TEXT NOT NULL,purpose TEXT NOT NULL,sid_digest TEXT NOT NULL,principal_id TEXT NOT NULL,subject TEXT NOT NULL,app_id TEXT NOT NULL,auth_version INTEGER NOT NULL,issued_at INTEGER NOT NULL,session_expires_at INTEGER NOT NULL,actor_id TEXT NOT NULL,agent_id TEXT NOT NULL,root_ref TEXT NOT NULL,root_jwk TEXT NOT NULL,fingerprint TEXT NOT NULL,display TEXT NOT NULL,expected_version INTEGER NOT NULL,redirect_uri TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,consumed_at INTEGER,completed_at INTEGER)');
 });}
 private row(actorId:string){return this.storage.sql.exec('SELECT * FROM personal_claims WHERE actor_id=?',actorId).toArray()[0];}
 private version(actorId:string){const r=this.row(actorId);if(!r)return 0;if(!integer(r.version)||r.version<1||r.version>=Number.MAX_SAFE_INTEGER)return fail('claim_unavailable');return r.version;}
 private base(actorId:string):Omit<Context,'fingerprint'|'display'> {
  const a=this.auth.owners.actor(actorId);if(!a)return fail('draft_required');
  const p=this.auth.owners.principal(a.principalId),r=this.storage.sql.exec('SELECT actor_id,agent_id,public_jwk FROM personal_actor_roots WHERE root_ref=?',a.rootRef).toArray()[0];
  if(!p||p.provider!=='threads'||!r||r.actor_id!==a.actorId||r.agent_id!==a.agentId||!this.auth.owners.profile(a.actorId)||p.subject.split(':')[0]!==this.cfg.appId||!/^\d{1,128}$/.test(p.subject.slice(this.cfg.appId.length+1)))return fail('claim_binding_invalid');
  return{actorId:a.actorId,principalId:p.id,appId:this.cfg.appId,subject:p.subject.slice(this.cfg.appId.length+1),agentId:a.agentId,rootRef:a.rootRef,rootJwk:String(r.public_jwk),version:this.version(a.actorId)};
 }
 private sameBase(c:Omit<Context,'fingerprint'|'display'>):boolean {
  try{const b=this.base(c.actorId);return b.actorId===c.actorId&&b.principalId===c.principalId&&b.appId===c.appId&&b.subject===c.subject&&b.agentId===c.agentId&&b.rootRef===c.rootRef&&b.rootJwk===c.rootJwk&&b.version===c.version;}catch{return false;}
 }
 private guard(b:PersonalBinding){if(!b||b.appId!==this.cfg.appId||!this.auth.active(b.sidDigest,b.proof,b.appId,this.now()))return fail('personal_session_required');return this.auth.owners.actorForPrincipal(b.proof.principalId)??fail('draft_required');}
 private async context(actorId:string):Promise<Context>{
  const b=this.base(actorId);let p:EcPublicJwk;
  try{p=JSON.parse(b.rootJwk);if(await jwkThumbprint(p)!==b.agentId||!this.sameBase(b))throw Error();}catch{return fail('claim_binding_invalid');}
  // Private random principal reference, not a raw account id or a changeable display handle.
  const owner=hex(await sha256('musely-personal-owner-v1:'+b.principalId));if(!this.sameBase(b))return fail('claim_changed');
  const f=await claimFingerprint(p,owner);if(!this.sameBase(b))return fail('claim_changed');
  return{...b,fingerprint:f.full,display:f.display};
 }
 current(actorId:string){return currentPersonalClaim(this.storage.sql,actorId,this.now());}
 async describe(b:PersonalBinding):Promise<PersonalClaimProjection>{
  const a=this.guard(b),c=await this.context(a.actorId);this.guard(b);
  const r=this.row(a.actorId),current=this.current(a.actorId);
  return{actorId:a.actorId,status:current.status,claimed:current.claimed,version:c.version,fingerprint:c.fingerprint,display:c.display,text:claimText(c.display),permalink:typeof r?.permalink==='string'?r.permalink:null,verifiedAt:nullableTime(r?.verified_at),checkedAt:nullableTime(r?.checked_at)};
 }
 async begin(b:PersonalBinding,input:unknown,flow:PersonalFlow):Promise<boolean>{
  if(!exact(input,'expectedVersion')||!integer((input as {expectedVersion:unknown}).expectedVersion))return fail('invalid_claim');
  const a=this.guard(b),c=await this.context(a.actorId);this.guard(b);
  if((input as {expectedVersion:number}).expectedVersion!==c.version)return fail('claim_changed');
  const at=this.now();
  if(!flow||!digest(flow.stateDigest)||!digest(flow.browserDigest)||flow.appId!==this.cfg.appId||flow.redirectUri!==this.cfg.redirectUri||!integer(flow.createdAt)||flow.createdAt>at||flow.expiresAt!==flow.createdAt+600000||flow.expiresAt<=at)return fail('invalid_claim');
  return this.storage.transactionSync(()=>{
   this.guard(b);const {fingerprint:_f,display:_d,...before}=c;if(JSON.stringify(this.base(c.actorId))!==JSON.stringify(before))return fail('claim_changed');
   this.storage.sql.exec('DELETE FROM personal_claim_flows WHERE expires_at<=?',at);
   if(Number(this.storage.sql.exec('SELECT count(*) n FROM personal_claim_flows').toArray()[0].n)>=256||this.storage.sql.exec('SELECT state_digest FROM personal_claim_flows WHERE state_digest=?',flow.stateDigest).toArray().length)return false;
   this.storage.sql.exec('INSERT INTO personal_claim_flows (state_digest,browser_digest,purpose,sid_digest,principal_id,subject,app_id,auth_version,issued_at,session_expires_at,actor_id,agent_id,root_ref,root_jwk,fingerprint,display,expected_version,redirect_uri,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',flow.stateDigest,flow.browserDigest,'claim',b.sidDigest,b.proof.principalId,c.subject,b.appId,b.proof.authVersion,b.proof.issuedAt,b.proof.expiresAt,c.actorId,c.agentId,c.rootRef,c.rootJwk,c.fingerprint,c.display,c.version,flow.redirectUri,flow.createdAt,flow.expiresAt);return true;
  });
 }
 private flowBinding(f:Record<string,unknown>):PersonalBinding{return{sidDigest:String(f.sid_digest),appId:String(f.app_id),proof:{principalId:String(f.principal_id),authVersion:Number(f.auth_version),issuedAt:Number(f.issued_at),expiresAt:Number(f.session_expires_at)} as PersonalSessionRow};}
 private validFlow(f:Record<string,unknown>,binding:ClaimFlowBinding,consumed:boolean){
  const at=this.now();if(!f||f.purpose!=='claim'||f.browser_digest!==binding.browserDigest||f.app_id!==binding.appId||binding.appId!==this.cfg.appId||f.redirect_uri!==binding.redirectUri||binding.redirectUri!==this.cfg.redirectUri||Number(f.created_at)>at||Number(f.expires_at)<=at||f.completed_at!==null||(consumed?f.consumed_at===null:f.consumed_at!==null))return false;
  try{const b=this.flowBinding(f),a=this.guard(b),c=this.base(a.actorId);return c.actorId===f.actor_id&&c.principalId===f.principal_id&&c.subject===f.subject&&c.appId===f.app_id&&c.agentId===f.agent_id&&c.rootRef===f.root_ref&&c.rootJwk===f.root_jwk&&c.version===Number(f.expected_version);}catch{return false;}
 }
 async complete(binding:ClaimFlowBinding,code:string|null):Promise<'claimed'|'declined'|'not_found'|'failed'|'invalid'>{
  if(!binding||!digest(binding.stateDigest)||!digest(binding.browserDigest))return'invalid';
  const f=this.storage.transactionSync(()=>{const r=this.storage.sql.exec('SELECT * FROM personal_claim_flows WHERE state_digest=?',binding.stateDigest).toArray()[0];if(!r||!this.validFlow(r,binding,false))return null;this.storage.sql.exec('UPDATE personal_claim_flows SET consumed_at=? WHERE state_digest=? AND consumed_at IS NULL',this.now(),binding.stateDigest);return{...r,consumed_at:this.now()} as Record<string,unknown>;});
  if(!f)return'invalid';if(code===null)return'declined';
  try{
   const c=await this.context(String(f.actor_id));if(!this.validFlow(f,binding,true)||c.fingerprint!==f.fingerprint)return'invalid';
   const p=await verifyPersonalClaim(this.cfg,code,{subject:c.subject,display:c.display,text:claimText(c.display)},this.now());
   if(!this.validFlow(f,binding,true))return'invalid';
   const after=await this.context(c.actorId);if(!this.validFlow(f,binding,true)||!same(after,c))return'invalid';
   if(p.subject!==c.subject||!/^\d{1,128}$/.test(p.postId)||!integer(p.checkedAt)||p.checkedAt>this.now()||!integer(p.tokenExpiresAt)||p.tokenExpiresAt<=this.now()||p.tokenExpiresAt>this.now()+60*86400000)return'failed';
   const next=c.version+1,sealed=await sealClaimToken(this.cfg.secret,cipherBinding(c,next),p.token);
   if(!this.validFlow(f,binding,true)||!this.sameBase(c))return'invalid';
   return this.storage.transactionSync(()=>{
    if(!this.validFlow(f,binding,true)||!this.sameBase(c))return'invalid';
    this.storage.sql.exec('INSERT INTO personal_claims (actor_id,principal_id,app_id,subject,agent_id,root_ref,root_jwk,fingerprint,version,status,verified_at,checked_at,post_id,permalink,token_cipher,token_expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(actor_id) DO UPDATE SET principal_id=excluded.principal_id,app_id=excluded.app_id,subject=excluded.subject,agent_id=excluded.agent_id,root_ref=excluded.root_ref,root_jwk=excluded.root_jwk,fingerprint=excluded.fingerprint,version=excluded.version,status=excluded.status,verified_at=excluded.verified_at,checked_at=excluded.checked_at,post_id=excluded.post_id,permalink=excluded.permalink,token_cipher=excluded.token_cipher,token_expires_at=excluded.token_expires_at',c.actorId,c.principalId,c.appId,c.subject,c.agentId,c.rootRef,c.rootJwk,c.fingerprint,next,'claimed',p.checkedAt,p.checkedAt,p.postId,p.permalink,sealed,p.tokenExpiresAt);
    this.storage.sql.exec('UPDATE personal_claim_flows SET completed_at=? WHERE state_digest=?',this.now(),binding.stateDigest);return'claimed';
   });
  }catch(e){return e&&typeof e==='object'&&'code'in e&&e.code==='missing'?'not_found':'failed';}
 }
 private writeLoss(c:Context,status:PersonalClaimStatus){
  const at=this.now(),version=c.version+1;
  this.storage.sql.exec('INSERT INTO personal_claims (actor_id,principal_id,app_id,subject,agent_id,root_ref,root_jwk,fingerprint,version,status,checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(actor_id) DO UPDATE SET version=excluded.version,status=excluded.status,checked_at=excluded.checked_at,token_cipher=NULL,token_expires_at=NULL',c.actorId,c.principalId,c.appId,c.subject,c.agentId,c.rootRef,c.rootJwk,c.fingerprint,version,status,at);
  if(['claim_revoked','mismatch'].includes(status))this.onLost(c.actorId,status,version);
 }
 async revoke(b:PersonalBinding,input:unknown):Promise<PersonalClaimProjection>{
  if(!exact(input,'expectedVersion')||!integer((input as {expectedVersion:unknown}).expectedVersion))return fail('invalid_claim');
  const a=this.guard(b),c=await this.context(a.actorId);
  this.storage.transactionSync(()=>{this.guard(b);if(c.version!==(input as {expectedVersion:number}).expectedVersion||!this.sameBase(c))return fail('claim_changed');this.writeLoss(c,'claim_revoked');});
  return this.describe(b);
 }
 async refresh(actorId:string):Promise<void>{
  const existing=this.pending.get(actorId);if(existing)return existing;
  const task=this.refreshOnce(actorId);this.pending.set(actorId,task);try{await task;}finally{if(this.pending.get(actorId)===task)this.pending.delete(actorId);}
 }
 private async refreshOnce(actorId:string){
  const row=this.row(actorId);if(!row||!['claimed','unavailable'].includes(String(row.status)))return;
  const at=this.now(),interval=row.status==='unavailable'?60000:600000;if(integer(row.checked_at)&&at-row.checked_at<interval&&Number(row.token_expires_at)>at)return;
  let c:Context;try{c=await this.context(actorId);}catch{return;}
  const still=()=>{const r=this.row(actorId);return this.sameBase(c)&&!!r&&r.version===row.version&&r.principal_id===c.principalId&&r.subject===c.subject&&r.app_id===c.appId&&r.agent_id===c.agentId&&r.root_ref===c.rootRef&&r.root_jwk===c.rootJwk&&r.fingerprint===c.fingerprint&&r.status===row.status&&r.token_cipher===row.token_cipher&&r.token_expires_at===row.token_expires_at&&r.post_id===row.post_id;};
  if(!still())return;
  if(!integer(row.token_expires_at)||row.token_expires_at<=at||typeof row.token_cipher!=='string'){this.storage.transactionSync(()=>{if(still())this.writeLoss(c,'reauth_required');});return;}
  let token:string;try{token=await openClaimToken(this.cfg.secret,cipherBinding(c,c.version),row.token_cipher);}catch{this.storage.transactionSync(()=>{if(still())this.writeLoss(c,'reauth_required');});return;}
  if(!still())return;
  const r=await recheckPersonalClaim(this.cfg,{subject:c.subject,postId:String(row.post_id),display:c.display,text:claimText(c.display),token,tokenExpiresAt:row.token_expires_at},this.now());token='';
  this.storage.transactionSync(()=>{if(!still())return;
   if(r.status==='verified')this.storage.sql.exec("UPDATE personal_claims SET status='claimed',checked_at=? WHERE actor_id=? AND version=?",this.now(),actorId,c.version);
   else if(r.status==='unavailable')this.storage.sql.exec("UPDATE personal_claims SET status='unavailable',checked_at=? WHERE actor_id=? AND version=?",this.now(),actorId,c.version);
   else this.writeLoss(c,r.status==='missing'?'claim_revoked':r.status==='mismatch'?'mismatch':'reauth_required');
  });
 }
}
