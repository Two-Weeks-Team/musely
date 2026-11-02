// Real-call probe for the Meta Model API (task 0). Reads the key from MODEL_API_KEY or from the
// git-ignored preview/.env.local; never prints or stores it.
// Records model, response id, latency, usage and output under docs/probes/ (no image bytes).
// Usage: node scripts/model-probe.mjs [text|image|all] [--image path]
import {readFile, writeFile, mkdir} from 'node:fs/promises';

const BASE = 'https://api.meta.ai/v1', MODEL = 'muse-spark-1.3';
async function apiKey() {
  if (process.env.MODEL_API_KEY) return process.env.MODEL_API_KEY.trim();
  const text = await readFile(new URL('../.env.local', import.meta.url), 'utf8');
  const line = text.split('\n').find(l => l.startsWith('MODEL_API_KEY='));
  if (!line) throw new Error('MODEL_API_KEY not found');
  return line.slice('MODEL_API_KEY='.length).trim();
}

async function call(name, body) {
  const key = await apiKey(), started = Date.now();
  const res = await fetch(BASE + '/chat/completions', {method: 'POST', headers: {authorization: 'Bearer ' + key, 'content-type': 'application/json'}, body: JSON.stringify({model: MODEL, reasoning_effort: 'minimal', ...body})});
  const latencyMs = Date.now() - started, text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  const headers = Object.fromEntries([...res.headers].filter(([k]) => /request|ratelimit|trace|^x-|cf-ray/i.test(k)));
  const record = {probe: name, at: new Date().toISOString(), model: MODEL, reasoning_effort: body.reasoning_effort ?? 'minimal', status: res.status, latencyMs, headers, id: json?.id ?? null, usage: json?.usage ?? null, output: json?.choices?.[0]?.message?.content ?? null, error: res.ok ? null : text.slice(0, 600)};
  await mkdir(new URL('../docs/probes/', import.meta.url), {recursive: true});
  await writeFile(new URL(`../docs/probes/${name}.json`, import.meta.url), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({probe: name, status: res.status, latencyMs, id: record.id, usage: record.usage, output: record.output?.slice(0, 400)}, null, 1));
  return record;
}

const schema = (name, properties, required = Object.keys(properties)) => ({type: 'json_schema', json_schema: {name, strict: true, schema: {type: 'object', additionalProperties: false, properties, required}}});
const mode = process.argv[2] ?? 'all';

if (mode === 'text' || mode === 'all') {
  await call('text-structured', {
    max_tokens: 1200,
    messages: [
      {role: 'system', content: 'You are Ripple, an explorer Muse in a shared neighborhood world. Decide one next move. Reply only with JSON matching the schema.'},
      {role: 'user', content: 'World: 14:10 local. You hold Paper Map L1. Nearby: Moss at the garden (holds Clover Seed), Andytown Coffee 220 m, bus stop Willow Rd & Hamilton Ave 180 m. Freedom: where to go.'},
    ],
    response_format: schema('spotlight_decision', {freedom: {type: 'string', enum: ['where']}, decision: {type: 'string'}, target_place: {type: 'string'}, public_reason: {type: 'string'}}),
  });
}

if (mode === 'image' || mode === 'all') {
  const at = process.argv.indexOf('--image');
  const path = at > 0 ? process.argv[at + 1] : new URL('../assets/variant_a.png', import.meta.url);
  const bytes = await readFile(path), mime = String(path).endsWith('.png') ? 'image/png' : 'image/jpeg';
  await call(at > 0 ? 'image-challenge' : 'image-structured', {
    max_tokens: 1200,
    messages: [
      {role: 'system', content: 'You judge a liveness challenge frame. Reply only with JSON matching the schema.'},
      {role: 'user', content: [
        {type: 'text', text: at > 0 ? 'Instruction for this step: raise your left hand. Did the person in the frame do it?' : 'Describe what this image shows. Is there a person raising a hand?'},
        {type: 'image_url', image_url: {url: `data:${mime};base64,${bytes.toString('base64')}`}},
      ]},
    ],
    response_format: schema('challenge_step', {step: {type: 'string'}, passed: {type: 'boolean'}, confidence: {type: 'number'}, observation: {type: 'string'}}),
  });
}
