// Callback adapter only: synthetic stubs, no provider/account/token calls.
import test from 'node:test';import assert from 'node:assert/strict';
import{personalRoutes}from'../worker/core/personal-api.ts';
import{PERSONAL_CLAIM_STATE_PREFIX,PERSONAL_CLAIM_FLOW_COOKIE,clearClaimFlowCookie}from'../worker/core/personal-session.ts';
const ORIGIN='https://musely.net',PATH='/api/threads/callback',state=PERSONAL_CLAIM_STATE_PREFIX+'a'.repeat(43),verifier='b'.repeat(43),cfg={origin:ORIGIN,secret:'synthetic-session-secret',appId:'123456789',appSecret:'synthetic-app-secret'};
async function call(query,{accept='text/html',cookie=PERSONAL_CLAIM_FLOW_COOKIE+'='+verifier,result='declined',throws=false}={}){const calls=[];const stub={personalClaimComplete:async(binding,code)=>{calls.push({binding,code});if(throws)throw Error('PRIVATE_THROW_CANARY');return result;}},url=new URL(ORIGIN+PATH+'?'+query),r=await personalRoutes(new Request(url,{headers:{accept,cookie}}),url,cfg,stub);return{r,calls};}
async function safe(r){assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.deepEqual(r.headers.getSetCookie(),[clearClaimFlowCookie]);assert.doesNotMatch(JSON.stringify([...r.headers])+await r.clone().text(),/PRIVATE_|synthetic-session-secret|synthetic-app-secret/);}
test('claim cancellation treats error or error_reason presence as code null without touching login cookies',async()=>{
 for(const fields of['error_reason=PRIVATE_REASON_CANARY','error_reason=','error=PRIVATE_ERROR_CANARY&error_reason=PRIVATE_REASON_CANARY']){const{r,calls}=await call('state='+state+'&'+fields);assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/?personalClaim=declined');assert.equal(calls.length,1);assert.equal(calls[0].code,null);await safe(r);}
});
test('ambiguous and duplicate claim queries stop before completion in both HTML and JSON',async()=>{
 for(const fields of['code=PRIVATE_CODE_CANARY&error_reason=cancel','code=PRIVATE_CODE_CANARY&error=cancel','error_reason=one&error_reason=two','error_description=one&error_description=two','error=one&error=two','code=one&code=two','state='+state+'&code=one','extra=one&code=one'])for(const accept of['text/html','application/json']){const{r,calls}=await call('state='+state+'&'+fields,{accept});assert.equal(r.status,400);assert.equal(calls.length,0);await safe(r);if(accept==='text/html'){assert.match(r.headers.get('content-type'),/text\/html/);assert.match(await r.text(),/href="\/"/);}else assert.deepEqual(await r.json(),{error:'auth_flow_invalid'});}
});
test('invalid/replayed/expired claim results and invalid browser proof have a fixed HTML return and preserve JSON400',async()=>{
 for(const result of['invalid'])for(const accept of['text/html','application/json']){const{r,calls}=await call('state='+state+'&code=PRIVATE_CODE_CANARY',{accept,result});assert.equal(calls.length,1);assert.equal(r.status,400);await safe(r);if(accept==='text/html'){assert.match(r.headers.get('content-type'),/text\/html/);assert.match(await r.text(),/Keep watching/);}else assert.deepEqual(await r.json(),{error:'auth_flow_invalid'});}
 const{r,calls}=await call('state='+state+'&code=PRIVATE_CODE_CANARY',{cookie:'musely_pf=PRIVATE_LOGIN_CANARY; musely_p=PRIVATE_SESSION_CANARY'});assert.equal(calls.length,0);assert.equal(r.status,400);assert.match(r.headers.get('content-type'),/text\/html/);await safe(r);
});
test('claim completion results are allowlisted and an RPC exception returns fixed failed without raw reflection',async()=>{
 for(const result of['claimed','declined','not_found','failed','PRIVATE_TOKEN_CANARY',null,{token:'PRIVATE_TOKEN_CANARY'}]){const{r}=await call('state='+state+'&code=PRIVATE_CODE_CANARY',{result});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/?personalClaim='+(['claimed','declined','not_found','failed'].includes(result)?result:'failed'));await safe(r);}
 const{r,calls}=await call('state='+state+'&code=PRIVATE_CODE_CANARY',{throws:true});assert.equal(calls.length,1);assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/?personalClaim=failed');await safe(r);
});
