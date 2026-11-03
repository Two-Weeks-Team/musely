// Pure current-proof read shared by Agent Cards, callers and counterparty commit guards.
import type {Sql} from './ledger.ts';
export type PersonalClaimStatus='pending_claim'|'claimed'|'claim_revoked'|'mismatch'|'reauth_required'|'unavailable';
export type CurrentPersonalClaim={claimed:boolean;fingerprint:string|null;version:number;status:PersonalClaimStatus};
const empty=():CurrentPersonalClaim=>({claimed:false,fingerprint:null,version:0,status:'pending_claim'});
export function currentPersonalClaim(sql:Sql,actorId:string,now=Date.now()):CurrentPersonalClaim{
 try{
  const r=sql.exec('SELECT c.principal_id,c.app_id,c.subject,c.agent_id,c.root_ref,c.root_jwk,c.fingerprint,c.version,c.status,c.verified_at,c.checked_at,c.token_expires_at,length(c.token_cipher) AS credential_bytes,a.principal_id AS current_principal,a.agent_id AS current_agent,a.root_ref AS current_root,r.public_jwk AS current_public,p.provider AS provider,p.subject AS provider_subject FROM personal_claims c JOIN personal_actors a ON a.actor_id=c.actor_id JOIN personal_actor_roots r ON r.root_ref=a.root_ref AND r.actor_id=a.actor_id AND r.agent_id=a.agent_id JOIN personal_principals p ON p.id=a.principal_id WHERE c.actor_id=?',actorId).toArray()[0];
  if(!r||r.principal_id!==r.current_principal||r.agent_id!==r.current_agent||r.root_ref!==r.current_root||r.root_jwk!==r.current_public||r.provider!=='threads'||r.provider_subject!==String(r.app_id)+':'+String(r.subject)||typeof r.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(r.fingerprint)||!Number.isSafeInteger(r.version)||Number(r.version)<1)return empty();
  const status:PersonalClaimStatus=['pending_claim','claimed','claim_revoked','mismatch','reauth_required','unavailable'].includes(String(r.status))?r.status as PersonalClaimStatus:'unavailable';
  const valid=status==='claimed'&&Number.isSafeInteger(now)&&Number.isSafeInteger(r.verified_at)&&Number(r.verified_at)<=now&&Number.isSafeInteger(r.checked_at)&&Number(r.checked_at)<=now&&Number.isSafeInteger(r.token_expires_at)&&Number(r.token_expires_at)>now&&Number(r.credential_bytes)>0;
  return{claimed:valid,fingerprint:r.fingerprint,version:Number(r.version),status:status==='claimed'&&!valid?'reauth_required':status};
 }catch{return empty();}
}
