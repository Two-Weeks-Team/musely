// Meta Model API call (OpenAI-compatible Chat Completions) with an 8-second deadline.
// After the deadline the request is aborted and any later answer is never used (direction v2, 8.7).
// The Worker calls the Meta Model API directly (MODEL_BASE https://api.meta.ai/v1); there is no AI Gateway in
// between, so no gateway headers are sent. Using a gateway is a separate decision: challenge and personal-signal
// bodies would first need gateway logging and caching turned off (docs/V2_VERIFICATION.md, section 5).
import {ACTION_LIMITS, OUTPUT_SCHEMAS, type Action} from './actions.ts';

export type ModelConfig = {base: string; key: string; fallbackKey?:string; model: string; timeoutMs: number; fetcher?: typeof fetch};
// Isolate-local cooldown: a new isolate or changed secret pair starts with primary.
const KEY_COOLDOWN_MS=60*60*1000;
const keySelections=new Map<string,{fallback:string;until:number;changedAt:number|null}>();
export function modelKeyStatus(cfg:{key?:string;fallbackKey?:string},now=Date.now()):{modelKey:'primary'|'fallback';modelKeyChangedAt:number|null}{
 const state=cfg.key?keySelections.get(cfg.key):undefined;
 if(!state||!cfg.fallbackKey||cfg.fallbackKey===cfg.key||state.fallback!==cfg.fallbackKey)return{modelKey:'primary',modelKeyChangedAt:null};
 if(state.until&&now>=state.until){state.until=0;state.changedAt=now;}
 return{modelKey:state.until>now?'fallback':'primary',modelKeyChangedAt:state.changedAt};
}
function paymentExhausted(status:number,body:string){
 if(status===402)return true;
 if(![401,403,429].includes(status))return false;
 let detail=body.slice(0,16384);try{const e=JSON.parse(detail)?.error;detail=typeof e==='string'?e:[e?.type,e?.code,e?.message].filter(v=>typeof v==='string').join(' ');}catch{}
 const financial=/credit|balance|billing|payment|insufficient[ _-]*(?:fund|quota)/i.test(detail);
 return financial||/quota/i.test(detail)&&!/rate[ _-]*limit|requests? per|tokens? per|\b(?:rpm|tpm)\b/i.test(detail);
}
export type Usage = {prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: {reasoning_tokens?: number}};
export type ModelResult =
  | {ok: true; output: unknown; responseId: string | null; requestId: string | null; latencyMs: number; usage: Usage | undefined}
  | {ok: false; kind: 'timeout' | 'rate_limited' | 'upstream' | 'bad_output' | 'network'; status?: number; latencyMs: number; requestId?: string | null; usage?: Usage};

export async function callModel(cfg: ModelConfig, action: Action, messages: unknown[], responseFormat: unknown = OUTPUT_SCHEMAS[action]): Promise<ModelResult> {
  const started = Date.now(), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  const initial=modelKeyStatus(cfg),usingFallback=initial.modelKey==='fallback';
  const headers: Record<string, string> = {authorization: 'Bearer ' + (usingFallback?cfg.fallbackKey:cfg.key), 'content-type': 'application/json'};
  // The deadline holds even if a fetch implementation ignores the abort signal: the wait itself is cut off.
  const deadline = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('deadline')), {once: true}));
  deadline.catch(() => {});
  try {
    const send=()=>Promise.race([(cfg.fetcher ?? fetch)(cfg.base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', headers, signal: controller.signal,
      body: JSON.stringify({model: cfg.model, messages, max_tokens: ACTION_LIMITS[action].maxTokens, reasoning_effort: ACTION_LIMITS[action].effort, response_format: responseFormat}),
    }), deadline]);
    let res=await send(),body=await Promise.race([res.text(),deadline]);
    if(!usingFallback&&cfg.fallbackKey&&cfg.fallbackKey!==cfg.key&&paymentExhausted(res.status,body)&&!controller.signal.aborted){
      const changedAt=Date.now();keySelections.set(cfg.key,{fallback:cfg.fallbackKey,until:changedAt+KEY_COOLDOWN_MS,changedAt});
      headers.authorization='Bearer '+cfg.fallbackKey;res=await send();body=await Promise.race([res.text(),deadline]);
    }
    const requestId = res.headers.get('x-request-id');
    const latencyMs = Date.now() - started;
    if (res.status === 429) return {ok: false, kind: 'rate_limited', status: 429, latencyMs, requestId};
    if (!res.ok) return {ok: false, kind: 'upstream', status: res.status, latencyMs, requestId};
    let json: any;
    try { json = JSON.parse(body); } catch { return {ok: false, kind: 'bad_output', status: res.status, latencyMs, requestId}; }
    const content = json?.choices?.[0]?.message?.content;
    let output: unknown;
    try { output = typeof content === 'string' ? JSON.parse(content) : null; } catch { output = null; }
    if (!output) return {ok: false, kind: 'bad_output', status: res.status, latencyMs, requestId, usage: json?.usage};
    return {ok: true, output, responseId: json?.id ?? null, requestId, latencyMs, usage: json?.usage};
  } catch (e) {
    const latencyMs = Date.now() - started;
    return {ok: false, kind: controller.signal.aborted ? 'timeout' : 'network', latencyMs};
  } finally {
    clearTimeout(timer);
  }
}
