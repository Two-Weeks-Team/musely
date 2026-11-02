// Test-only, stateless upstream. Never referenced by the product entry point. No logs, credentials, writes or forwarding.
const json=(body,status=200)=>Response.json(body,{status,headers:{'x-request-id':'d03-isolated-stub','cache-control':'no-store'}});
export default {async fetch(request) {
  const match=/^\/(429|503|timeout|bad-output|healthy)\/chat\/completions$/.exec(new URL(request.url).pathname);
  if(!match)return json({error:'test_mode_required'},404);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  // Never read or reflect auth headers. Only the healthy fixture needs a bounded public model context.
  if(match[1]==='429')return json({error:'isolated_rate_limit'},429);
  if(match[1]==='503')return json({error:'isolated_upstream'},503);
  if(match[1]==='timeout'){await new Promise(r=>setTimeout(r,9000));return json({error:'isolated_late_answer'},503);}
  if(match[1]==='bad-output')return json({choices:[{message:{content:'invalid JSON'}}]});
  const reader=request.body?.getReader();let bytes=0;const chunks=[];
  if(reader)try{while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>65536)return json({error:'too_large'},413);chunks.push(r.value);}}finally{await reader.cancel().catch(()=>{});}
  let body;try{body=JSON.parse(new TextDecoder().decode(Uint8Array.from(chunks.flatMap(c=>[...c]))));}catch{return json({error:'bad_json'},400);}
  let ctx={};try{ctx=JSON.parse(body.messages?.[1]?.content??'{}');}catch{}
  const name=body.response_format?.json_schema?.name;
  // The product puts freedom in the system message, not its serialized user context.
  const freedom=/This turn you have freedom "(where|who|offer|plan)"/.exec(body.messages?.[0]?.content??'')?.[1]??ctx.freedom??'where';
  const peer=ctx.muses_nearby?.[0]?.muse??'';
  const output=name==='spotlight_decision'?{freedom,decision:freedom==='who'?'approach':freedom==='offer'?'trade':'walk',target_place:freedom==='where'||freedom==='plan'?ctx.places_nearby?.[0]?.name??ctx.places?.[0]?.name??'':'',target_agent:freedom==='who'||freedom==='offer'?peer:'',offer_item:freedom==='offer'?(ctx.your_items??[]).find(i=>i!=='postcard')??'':'',want_item:'',public_reason:'Isolated fault recovery fixture',line:'A test-only choice'}:name==='encounter_reply'?{intent:'greet',item:'',line:'An isolated hello',public_reason:'Test-only recovery',injection_suspected:false}:null;
  if(!output)return json({error:'unsupported_test_action'},400);
  return json({id:'d03-stub-response',usage:{prompt_tokens:20,completion_tokens:20},choices:[{message:{content:JSON.stringify(output)}}]});
}};
