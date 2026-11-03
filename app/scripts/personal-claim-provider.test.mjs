// Synthetic provider DI only. No account, credential file, provider or model requests.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyPersonalClaim,recheckPersonalClaim,PersonalClaimProviderError} from '../worker/core/personal-claim-provider.ts';
const NOW=1793728000000,SUBJECT='900719925474099312345',POST='18000000000000001';
const DISPLAY='abcd 1234 efab 5678',TEXT=`I am claiming my Muse on Musely. Fingerprint: ${DISPLAY} · musely.net`;
const SHORT='SYNTHETIC_SHORT_TOKEN',LONG='SYNTHETIC_LONG_TOKEN',CODE='SYNTHETIC_OAUTH_CODE',SECRET='SYNTHETIC_APP_SECRET';
const expected=()=>({subject:SUBJECT,display:DISPLAY,text:TEXT,postId:POST});
const post=()=>({id:POST,owner:{id:SUBJECT},username:'synthetic_owner',text:TEXT,permalink:'https://www.threads.com/@synthetic_owner/post/Example',timestamp:'2026-11-03T18:00:00+0000'});
const credential=()=>({...expected(),postId:POST,token:LONG,tokenExpiresAt:NOW+60000});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
function cfg(overrides={}){const calls=[];return {calls,config:{appId:'123456789',appSecret:SECRET,redirectUri:'https://musely.net/api/threads/callback',fetcher:async(raw,init)=>{
 const u=new URL(raw);assert.equal(u.origin,'https://graph.threads.com');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'manual');assert.equal(init.cache,'no-store');assert.ok(init.signal);assert.ok(!new Headers(init.headers).has('cookie'));calls.push({u,init});
 if(overrides.fetcher)return overrides.fetcher(u,init,calls.length);
 if(u.pathname==='/oauth/access_token'){assert.equal(init.method,'POST');const b=new URLSearchParams(init.body);assert.equal(b.get('grant_type'),'authorization_code');assert.equal(b.get('code'),CODE);assert.equal(b.get('redirect_uri'),'https://musely.net/api/threads/callback');assert.equal(b.get('client_secret'),SECRET);return json({access_token:SHORT,user_id:SUBJECT,token_type:'bearer'});}
 if(u.pathname==='/v1.0/me'){assert.equal(u.searchParams.get('fields'),'id,username');return json({id:overrides.subject??SUBJECT,username:'synthetic_owner'});}
 if(u.pathname==='/v1.0/me/threads'){assert.equal(u.searchParams.get('limit'),'25');assert.equal(u.searchParams.get('fields'),'id,text,permalink,owner,username,timestamp');return json({data:overrides.posts??[post()],paging:{next:'https://not-followed.invalid/?access_token=PRIVATE_PAGING'}});}
 if(u.pathname==='/access_token'){assert.equal(init.method,'GET');assert.equal(u.searchParams.get('grant_type'),'th_exchange_token');assert.equal(u.searchParams.get('access_token'),SHORT);assert.equal(u.searchParams.get('client_secret'),SECRET);return json(overrides.long??{access_token:LONG,token_type:'bearer',expires_in:5184000});}
 if(u.pathname==='/v1.0/'+POST)return json(overrides.recheckedPost??post());
 throw Error('unexpected synthetic endpoint');
 },...(overrides.timeoutMs?{timeoutMs:overrides.timeoutMs}:{})}};}
const failure=code=>e=>e instanceof PersonalClaimProviderError&&e.name==='PersonalClaimProviderError'&&e.code===code&&e.message==='personal_claim_provider_failed';

test('provider and UI agree on all official Threads permalink hosts and discard unsafe links',async()=>{
 const {parsePersonalClaim}=await import('../src/ui/personal-claim.ts');
 const actorId='pm_11111111-1111-4111-8111-111111111111';
 for(const host of ['threads.com','www.threads.com','threads.net','www.threads.net']){
  const permalink=`https://${host}/@synthetic_owner/post/Example`;
  const f=cfg({posts:[{...post(),permalink}]}),r=await verifyPersonalClaim(f.config,CODE,expected(),NOW);
  assert.equal(r.permalink,permalink);
  assert.equal(parsePersonalClaim({actorId,status:'claimed',claimed:true,version:1,fingerprint:DISPLAY.replaceAll(' ','').padEnd(64,'0'),display:DISPLAY,text:TEXT,permalink:r.permalink,verifiedAt:NOW,checkedAt:NOW},actorId).claimed,true);
 }
 for(const permalink of ['https://www.threads.com:8443/@synthetic_owner/post/Example','https://www.threads.com/not-a-post','https://user:pass@www.threads.com/@synthetic_owner/post/Example','https://www.threads.com/@synthetic_owner/post/Example?token=CANARY','https://www.threads.com/@synthetic_owner/post/Example#CANARY','https://www.threads.com.evil.invalid/@synthetic_owner/post/Example']){
  const f=cfg({posts:[{...post(),permalink}]});assert.equal((await verifyPersonalClaim(f.config,CODE,expected(),NOW)).permalink,null);
 }
});

test('verified own post uses four bounded reads/exchanges, never publishes, and returns the long token only to its trusted caller',async()=>{
 const f=cfg(),r=await verifyPersonalClaim(f.config,CODE,expected(),NOW);
 assert.equal(r.subject,SUBJECT);assert.equal(r.postId,POST);assert.equal(r.token,LONG);assert.equal(r.permalink,post().permalink);assert.ok(r.checkedAt>=NOW&&r.checkedAt<NOW+1000);assert.ok(r.tokenExpiresAt>NOW&&r.tokenExpiresAt<=r.checkedAt+5184000000);
 assert.deepEqual(f.calls.map(x=>[x.init.method,x.u.pathname]),[['POST','/oauth/access_token'],['GET','/v1.0/me'],['GET','/v1.0/me/threads'],['GET','/access_token']]);assert.ok(!f.calls.some(x=>/publish|refresh/.test(x.u.pathname)));
});
test('full text normalization permits whitespace only, not extra text or a wrong fingerprint',async()=>{
 const p=post();p.text='  '+TEXT.replaceAll(' ','\n')+'  ';const f=cfg({posts:[p]});assert.equal((await verifyPersonalClaim(f.config,CODE,expected(),NOW)).postId,POST);
 for(const text of [TEXT+' unrelated',TEXT.replace(DISPLAY,'0000 0000 0000 0000')]){const f=cfg({posts:[{...post(),text}]});await assert.rejects(verifyPersonalClaim(f.config,CODE,expected(),NOW),failure('mismatch'));assert.equal(f.calls.length,3);}
});
test('wrong subject stops before post reads and foreign/missing ownership never verifies',async()=>{
 const f=cfg({subject:'42'});await assert.rejects(verifyPersonalClaim(f.config,CODE,expected(),NOW),failure('mismatch'));assert.equal(f.calls.length,2);
 for(const owner of [{id:'42'},undefined,{id:9007199254740993}]){const f=cfg({posts:[{...post(),owner}]});await assert.rejects(verifyPersonalClaim(f.config,CODE,expected(),NOW),failure('mismatch'));assert.equal(f.calls.length,3);}
});
test('an older post outside the one-page bound is missing and pagination is never followed',async()=>{
 const f=cfg({posts:[{...post(),id:'18000000000000002'}]});await assert.rejects(verifyPersonalClaim(f.config,CODE,expected(),NOW),failure('missing'));assert.equal(f.calls.length,3);
 const g=cfg();const e=expected();delete e.postId;assert.equal((await verifyPersonalClaim(g.config,CODE,e,NOW)).postId,POST);assert.equal(g.calls.length,4);
});
test('long exchange failure or invalid expiry cannot be recorded as successful verification',async()=>{
 for(const long of [{error:{code:190,message:'PRIVATE_PROVIDER_ERROR'}},{access_token:LONG,expires_in:0},{access_token:LONG,expires_in:5184001},{access_token:LONG,expires_in:'5184000'},{access_token:LONG,expires_in:1.5},{expires_in:5184000}]){const f=cfg({long});await assert.rejects(verifyPersonalClaim(f.config,CODE,expected(),NOW),e=>failure(long.error?'reauth_required':'unavailable')(e));assert.equal(f.calls.length,4);}
});
test('recheck verifies identity then the stored own post without refresh or token exchange',async()=>{const f=cfg(),r=await recheckPersonalClaim(f.config,credential(),NOW);assert.equal(r.status,'verified');assert.deepEqual(f.calls.map(x=>x.u.pathname),['/v1.0/me','/v1.0/'+POST]);});
test('edited and foreign posts are mismatch, not missing or verified',async()=>{for(const p of [{...post(),text:TEXT+' edited'},{...post(),owner:{id:'42'}},{...post(),id:'18000000000000002'}]){const f=cfg({recheckedPost:p});assert.equal((await recheckPersonalClaim(f.config,credential(),NOW)).status,'mismatch');assert.equal(f.calls.length,2);}});
test('local expiry is reauth_required with no HTTP',async()=>{const f=cfg(),c=credential();c.tokenExpiresAt=NOW;assert.equal((await recheckPersonalClaim(f.config,c,NOW)).status,'reauth_required');assert.equal(f.calls.length,0);});
test('post-only 404 and HTTP400 Graph100/33 are missing; auth190 is reauth and ordinary 403 stays unavailable',async()=>{
 for(const [http,data,want] of [[404,{error:{message:'PRIVATE_NOT_FOUND'}},'missing'],[400,{error:{code:100,error_subcode:33,message:'PRIVATE_NOT_FOUND'}},'missing'],[403,{error:{code:190,message:'PRIVATE_AUTH'}},'reauth_required'],[403,{error:{code:10}},'unavailable'],[403,{error:{message:'PRIVATE_UNKNOWN'}},'unavailable'],[400,{error:{code:100}},'unavailable'],[200,{error:{message:'PRIVATE_UNKNOWN'}},'unavailable']]){const f=cfg({fetcher:async u=>u.pathname==='/v1.0/me'?json({id:SUBJECT,username:'synthetic_owner'}):json(data,http)});assert.equal((await recheckPersonalClaim(f.config,credential(),NOW)).status,want);assert.equal(f.calls.length,2);}
 const f=cfg({fetcher:async()=>json({error:{code:100,error_subcode:33}},404)});assert.equal((await recheckPersonalClaim(f.config,credential(),NOW)).status,'unavailable');assert.equal(f.calls.length,1,'an unavailable /me is not evidence that the post was deleted');
});
test('provider error messages, credentials and raw code are never exposed through errors, results or logs',async t=>{
 const logs=[],old=console.error;console.error=(...v)=>logs.push(v);t.after(()=>console.error=old);
 const f=cfg({fetcher:async()=>{throw Error('PRIVATE_PROVIDER_ERROR '+SECRET+' '+CODE);}});let caught;try{await verifyPersonalClaim(f.config,CODE,expected(),NOW);}catch(e){caught=e;}assert.ok(failure('unavailable')(caught));assert.doesNotMatch(JSON.stringify(caught)+caught.message+caught.stack,/PRIVATE_PROVIDER_ERROR|SYNTHETIC_APP_SECRET|SYNTHETIC_OAUTH_CODE/);assert.deepEqual(logs,[]);
});

test('a total deadline bounds a stuck fetch and is not restarted between provider calls',async()=>{
 let signal;const f=cfg({timeoutMs:15,fetcher:async(_u,init)=>{signal=init.signal;return new Promise(()=>{});}});await assert.rejects(verifyPersonalClaim(f.config,CODE,expected(),NOW),failure('unavailable'));assert.equal(f.calls.length,1);assert.equal(signal.aborted,true);
 const g=cfg({timeoutMs:30,fetcher:async u=>{await new Promise(r=>setTimeout(r,18));return u.pathname==='/oauth/access_token'?json({access_token:SHORT}):json({id:SUBJECT});}});await assert.rejects(verifyPersonalClaim(g.config,CODE,expected(),NOW),failure('unavailable'));assert.ok(g.calls.length<4,'each call must share the same deadline');
});
test('a complete JSON chunk with a late EOF cannot escape the final exchange deadline',async()=>{
 let cancelled=false;const f=cfg({timeoutMs:20,fetcher:async u=>{
  if(u.pathname==='/oauth/access_token')return json({access_token:SHORT});
  if(u.pathname==='/v1.0/me')return json({id:SUBJECT});
  if(u.pathname==='/v1.0/me/threads')return json({data:[post()]});
  return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify({access_token:LONG,expires_in:5184000})));},cancel(){cancelled=true;}}));
 }});await assert.rejects(verifyPersonalClaim(f.config,CODE,expected(),NOW),failure('unavailable'));assert.equal(f.calls.length,4);assert.equal(cancelled,true);
});
test('an abort-ignoring fetch that resolves late has its body cancelled, with no subsequent request',async()=>{
 let cancelled=false;const f=cfg({timeoutMs:10,fetcher:async()=>{await new Promise(r=>setTimeout(r,35));return new Response(new ReadableStream({start(){},cancel(){cancelled=true;}}));}});await assert.rejects(verifyPersonalClaim(f.config,CODE,expected(),NOW),failure('unavailable'));await new Promise(r=>setTimeout(r,45));assert.equal(cancelled,true);assert.equal(f.calls.length,1);
});
test('per-body byte bound is inclusive at 64KiB and rejects the next byte for either operation',async()=>{
 const value={access_token:SHORT,padding:''},base=new TextEncoder().encode(JSON.stringify(value)).length;value.padding='x'.repeat(65536-base);let n=0;
 const f=cfg({fetcher:async u=>{n++;if(n===1)return json(value);if(u.pathname==='/v1.0/me')return json({id:SUBJECT});if(u.pathname==='/v1.0/me/threads')return json({data:[post()]});return json({access_token:LONG,expires_in:60});}});assert.equal((await verifyPersonalClaim(f.config,CODE,expected(),NOW)).token,LONG);
 const g=cfg({fetcher:async()=>new Response('x'.repeat(65537))});await assert.rejects(verifyPersonalClaim(g.config,CODE,expected(),NOW),failure('unavailable'));assert.equal(g.calls.length,1);
 const h=cfg({fetcher:async()=>new Response('x'.repeat(65537))});assert.equal((await recheckPersonalClaim(h.config,credential(),NOW)).status,'unavailable');assert.equal(h.calls.length,1);
});
test('redirects, malformed JSON and missing provider fields fail closed without following or retrying',async()=>{
 for(const response of [()=>new Response(null,{status:302,headers:{location:'https://not-followed.invalid/PRIVATE'}}),()=>new Response('not JSON'),()=>json({}),()=>json({error:{message:'PRIVATE_RAW_ERROR'}}),()=>new Response(Uint8Array.from([0xff]))]){const f=cfg({fetcher:async()=>response()});await assert.rejects(verifyPersonalClaim(f.config,CODE,expected(),NOW),failure('unavailable'));assert.equal(f.calls.length,1);}
 const f=cfg({posts:Array.from({length:26},post)});await assert.rejects(verifyPersonalClaim(f.config,CODE,expected(),NOW),failure('unavailable'));assert.equal(f.calls.length,3);
});
test('invalid input never starts provider requests and a token expiring during /me is not used to read a post',async()=>{
 for(const e of [{...expected(),subject:'app:42'},{...expected(),postId:'../foreign'},{...expected(),display:'wrong'}, {...expected(),text:''}]){const f=cfg();await assert.rejects(verifyPersonalClaim(f.config,CODE,e,NOW),failure('invalid_input'));assert.equal(f.calls.length,0);}
 const f=cfg({fetcher:async()=>{await new Promise(r=>setTimeout(r,15));return json({id:SUBJECT});}}),c=credential();c.tokenExpiresAt=NOW+5;assert.equal((await recheckPersonalClaim(f.config,c,NOW)).status,'reauth_required');assert.equal(f.calls.length,1);
});
test('unexpected permalink text is discarded and public/private post content is not copied to the result',async()=>{
 const f=cfg({posts:[{...post(),permalink:'PRIVATE_PROVIDER_CANARY',username:'PRIVATE_USERNAME_CANARY'}]});const result=await verifyPersonalClaim(f.config,CODE,expected(),NOW);assert.equal(result.permalink,null);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_PROVIDER_CANARY|PRIVATE_USERNAME_CANARY|Fingerprint|SYNTHETIC_SHORT_TOKEN/);
});
