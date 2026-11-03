// Claim-purpose credentials only. Ordinary login never calls this vault.
import {canonicalize} from '../../src/identity/jcs.ts';
import {b64url,unb64url} from './session.ts';

export type ClaimCipherBinding={actorId:string;principalId:string;appId:string;agentId:string;rootRef:string;fingerprint:string;version:number};
const enc=new TextEncoder();
const failure=()=>new Error('claim_credential_unavailable');
function aad(b:ClaimCipherBinding){
 if(!b||!['actorId','principalId','appId','agentId','rootRef','fingerprint'].every(k=>typeof b[k as keyof ClaimCipherBinding]==='string')||Object.keys(b).sort().join(',')!=='actorId,agentId,appId,fingerprint,principalId,rootRef,version'||!/^pm_[a-f0-9-]{36}$/.test(b.actorId)||!/^pp_[a-f0-9-]{36}$/.test(b.principalId)||!/^\d{1,32}$/.test(b.appId)||!/^root_ref:[A-Za-z0-9_-]{1,96}$/.test(b.rootRef)||!/^[-_A-Za-z0-9]{43}$/.test(b.agentId)||!/^[a-f0-9]{64}$/.test(b.fingerprint)||!Number.isSafeInteger(b.version)||b.version<1)throw failure();
 return enc.encode(canonicalize({purpose:'musely-personal-claim-token-v1',...b}));
}
async function key(secret:string){
 if(typeof secret!=='string'||secret.length<16||secret.length>16384)throw failure();
 const material=await crypto.subtle.importKey('raw',enc.encode(secret),'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode('musely-personal-claim-vault-v1'),info:enc.encode('encryption-only')},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function sealClaimToken(secret:string,binding:ClaimCipherBinding,token:string):Promise<string>{
 try{
  if(typeof token!=='string'||!token||/[\u0000-\u0020\u007f]/.test(token)||enc.encode(token).length>8192)throw failure();
  const additionalData=aad(binding),iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData,tagLength:128},await key(secret),enc.encode(token));
  return JSON.stringify({v:1,iv:b64url(iv),ciphertext:b64url(new Uint8Array(ciphertext))});
 }catch{throw failure();}
}
export async function openClaimToken(secret:string,binding:ClaimCipherBinding,envelope:string):Promise<string>{
 try{
  if(typeof envelope!=='string'||envelope.length>16000)throw failure();
  const x=JSON.parse(envelope);
  if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join(',')!=='ciphertext,iv,v'||x.v!==1||typeof x.iv!=='string'||!/^[A-Za-z0-9_-]{16}$/.test(x.iv)||typeof x.ciphertext!=='string'||!/^[A-Za-z0-9_-]{23,10944}$/.test(x.ciphertext))throw failure();
  const bytes=unb64url(x.ciphertext);if(bytes.length<17||bytes.length>8208)throw failure();
  const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64url(x.iv),additionalData:aad(binding),tagLength:128},await key(secret),bytes);
  const token=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(raw);
  if(!token||/[\u0000-\u0020\u007f]/.test(token))throw failure();
  return token;
 }catch{throw failure();}
}
