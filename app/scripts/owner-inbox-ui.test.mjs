// Real card handlers against a minimal DOM. Chromium integration remains a separate browser check.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const load = async file => {
  const r = await build({entryPoints: [new URL(file, import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent'});
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
};
const {ownerInboxCard} = await load('../src/ui/owner-inbox.ts');
const {ownerControlCard} = await load('../src/ui/identity.ts');
class Node {
  constructor(tag = '#text', text = '') { this.tagName = tag.toUpperCase(); this._text = text; this.childNodes = []; this.parentNode = null; this.attrs = {}; this.value = ''; this.checked = false; this.disabled = false; }
  get children() { return this.childNodes.filter(x => x.tagName !== '#TEXT'); }
  get textContent() { return this._text + this.childNodes.map(x => x.textContent).join(''); }
  set textContent(t) { this._text = String(t); this.replaceChildren(); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...xs) { for (let x of xs) { if (typeof x === 'string') x = new Node('#text', x); if (x.parentNode) x.remove(); x.parentNode = this; this.childNodes.push(x); } }
  replaceChildren(...xs) { for (const x of this.childNodes) x.parentNode = null; this.childNodes = []; this.append(...xs); }
  insertBefore(x, before) { if (x === before) return x; if (x.parentNode) x.remove(); const at = before == null ? this.childNodes.length : this.childNodes.indexOf(before); assert.ok(at >= 0); this.childNodes.splice(at, 0, x); x.parentNode = this; return x; }
  remove() { if (this.parentNode) { const a = this.parentNode.childNodes; a.splice(a.indexOf(this), 1); this.parentNode = null; } }
  contains(x) { return x === this || this.childNodes.some(c => c.contains(x)); }
  matches(s) {
    if (s.startsWith('.')) return (this.className ?? '').split(' ').includes(s.slice(1));
    const m = /^(\w+)(?:\[type=["']?(\w+)["']?\])?([:]checked)?$/.exec(s);
    return !!m && this.tagName === m[1].toUpperCase() && (!m[2] || this.type === m[2]) && (!m[3] || this.checked);
  }
  querySelectorAll(s) { return this.childNodes.flatMap(x => [...(x.matches(s) ? [x] : []), ...x.querySelectorAll(s)]); }
  querySelector(s) { return this.querySelectorAll(s)[0] ?? null; }
  focus() { document.activeElement = this; }
}
function dom() {
  globalThis.document = {createElement: tag => new Node(tag), createTextNode: text => new Node('#text', text), activeElement: null};
  globalThis.window = {localStorage: {getItem: () => null, setItem() {}}, confirm: () => true};
}
const flush = () => new Promise(r => setImmediate(r));
const response = (status, data) => ({ok: status < 300, status, json: async () => structuredClone(data)});
const task = (id = 'task_1', extra = {}) => ({task_id: id, kind: 'meetup', muse: '00-jolly', other: '09-copper', other_side: 'demo peer', status: 'input-required', stage: 'owner_approval', revision: 1, content_hash: 'a'.repeat(64), deadline: Date.now() + 18e5, deadline_iso: new Date().toISOString(),
  candidates: [{id: 'c1', time: '17:00', place: 'Cafe', place_id: 'commons:cafe', public_basis: 'public'}, {id: 'c2', time: '18:00', place: 'Garden', place_id: 'commons:garden', public_basis: 'public'}], yours: null, theirs: null, confirmed: null, ...extra});
const FIXTURE_EXPIRY=Date.now()+3600000;
const inbox = approvals => ({owner: {principal:'owner',ownerId:'owner',expiresAt:FIXTURE_EXPIRY,label: 'Owner', demo: false}, demo_limits: null, approvals, recent: [], notifications: [], approval_window_min: 30});
const named = (node, text) => node.querySelectorAll('button').find(x => x.textContent === text);

test('owner inbox refreshes a previous401 after sign-in and provides a manual retry', async () => {
  dom(); let signedIn = false; const requests = [];
  const f = async (url, init) => { requests.push({url, ...init}); return signedIn ? response(200, inbox([task()])) : response(401, {error: 'owner_session_required'}); };
  const card = ownerInboxCard(() => {}, f); await flush();
  assert.match(card.textContent, /Start the owner session/);
  assert.ok(named(card, 'Refresh owner inbox'), 'signed-out card has a manual refresh');
  signedIn = true; await named(card, 'Refresh owner inbox').onclick(); await flush();
  assert.match(card.textContent, /Waiting for your decision \(1\)/);
  assert.ok(named(card, 'Approve the chosen candidate'));
  assert.ok(requests.every(x => x.method === 'GET' && ['/api/owner/session','/api/owner/inbox'].includes(x.url) && !x.body));
});

test('a settled owner decision shows the chosen candidate and no new approve or decline controls', async () => {
  dom(); const yours = {decision: 'approve', candidate: 'c2', source: 'owner', at: Date.now(), approval_ref: 'ap_1'};
  const card = ownerInboxCard(() => {}, async () => response(200, inbox([task('task_1', {yours})]))); await flush();
  assert.match(card.textContent, /Your decision/); assert.match(card.textContent, /approved c2/);
  assert.match(card.textContent, /Chosen candidatec2 · 18:00 · Garden/);
  assert.match(card.textContent, /Waiting for the other side/);
  assert.equal(named(card, 'Approve the chosen candidate'), undefined);
  assert.equal(named(card, 'Decline'), undefined);
  assert.equal(card.querySelectorAll('input[type=radio]').length, 0);
  assert.match(card.textContent, /Waiting for your decision \(0\)/);
});

test('polls add new requests without resetting a private draft, a chosen candidate or the focused node', async () => {
  dom(); const first = task(); let data = inbox([first]); const requests = [];
  const card = ownerInboxCard(() => {}, async (url, init) => { requests.push({url, ...init}); return response(200, data); }); await flush();
  const draft = card.querySelector('input[type=text]'); draft.value = '17:00-18:00 unfinished'; draft.focus();
  const radios = card.querySelectorAll('input[type=radio]'); radios[0].checked = false; radios[1].checked = true;
  const retained = card.querySelector('.owner-approval');
  data = inbox([first, task('task_2')]); await card.refresh();
  assert.equal(card.querySelector('input[type=text]'), draft); assert.equal(draft.value, '17:00-18:00 unfinished'); assert.equal(document.activeElement, draft);
  assert.equal(card.querySelector('.owner-approval'), retained); assert.equal(radios[1].checked, true);
  assert.match(card.textContent, /Waiting for your decision \(2\)/);
  assert.ok(!JSON.stringify(requests).includes('unfinished'), 'a private draft never reaches a request');
});

test('an arriving other-owner decision preserves an undecided candidate picker and its focus', async () => {
  dom(); const first = task(); let data = inbox([first]);
  const card = ownerInboxCard(() => {}, async () => response(200, data)); await flush();
  const picker = card.querySelectorAll('input[type=radio]')[1]; picker.checked = true; picker.focus();
  const retained = card.querySelector('.owner-approval');
  data = inbox([{...first, theirs: {decision: 'approve', candidate: 'c2', source: 'owner', at: Date.now(), approval_ref: 'ap_other'}}]);
  await card.refresh();
  assert.equal(card.querySelector('.owner-approval'), retained);
  assert.equal(card.querySelectorAll('input[type=radio]')[1], picker);
  assert.equal(document.activeElement, picker);
  assert.match(card.textContent, /Their decisionapproved c2/);
});

test('explicitly checking new private conditions recomputes the suggested candidate', async () => {
  dom();
  const card = ownerInboxCard(() => {}, async () => response(200, inbox([task()]))); await flush();
  card.querySelector('input[type=text]').value = '17:00-17:30';
  named(card, 'Check candidates on this device').onclick(); await flush();
  assert.equal(card.querySelector('input[type=radio]:checked').value, 'c2');
});

test('the active gate makes no request while replay is open and ignores an answer after leaving Identity', async () => {
  dom(); let active = false, calls = 0;
  const card = ownerInboxCard(() => {}, async () => { calls++; return response(200, inbox([task()])); }, () => active); await flush();
  assert.equal(calls, 0); await card.refresh(); assert.equal(calls, 0);
  active = true; await card.refresh(); assert.equal(calls, 2);
  let resolve; const pending = new Promise(r => { resolve = r; });
  const late = ownerInboxCard(() => {}, async () => { calls++; return pending; }, () => active);
  await flush(); active = false; resolve(response(200, inbox([task('task_late')]))); await flush();
  assert.equal(late.querySelector('.owner-approval'), null);
});

test('successful session start and end notify the sibling owner inbox through onChange', async () => {
  dom(); let signedIn = false, changes = 0;
  globalThis.fetch = async (url, init) => {
    if (init.method === 'POST') signedIn = true;
    if (init.method === 'DELETE') signedIn = false;
    return response(200, init.method === 'GET' ? {owner: signedIn ? {label: 'Owner', ownerId: 'owner', demo: false, expiresAt: Date.now() + 36e5} : null, delegation: []} : {ok: true});
  };
  const card = ownerControlCard(() => changes++); await flush();
  card.querySelector('input[type=password]').value = 'local-test-token';
  await named(card, 'Start owner session').onclick();
  assert.equal(changes, 1, 'successful start refreshes dependent views');
  await named(card, 'End owner session').onclick();
  assert.equal(changes, 2, 'successful end clears dependent owner data');
});

for (const failure of ['503', 'network']) test(`an approval ${failure} failure restores both retry controls; a later successful decision removes them`, async () => {
  dom(); let attempts = 0;
  const data = inbox([task()]);
  const f = async (url, init) => {
    if (init.method === 'GET') return response(200, data);
    attempts++;
    if (attempts === 1) {
      if (failure === 'network') throw new Error('offline');
      return response(503, {error: 'temporary_failure'});
    }
    data.approvals[0].yours = {decision: 'approve', candidate: 'c1', source: 'owner', at: Date.now(), approval_ref: 'ap_retry'};
    return response(200, {confirmed: false});
  };
  const card = ownerInboxCard(() => {}, f); await flush();
  named(card, 'Approve the chosen candidate').onclick(); await flush(); await flush();
  const approve = named(card, 'Approve the chosen candidate'), decline = named(card, 'Decline');
  assert.equal(approve.disabled, false, `${failure}: approve can be retried`);
  assert.equal(decline.disabled, false, `${failure}: decline can be retried`);
  assert.match(card.textContent, failure === 'network' ? /network error/ : /HTTP 503/);
  approve.onclick(); await flush(); await flush();
  assert.equal(attempts, 2);
  assert.equal(named(card, 'Approve the chosen candidate'), undefined, 'the successful decision is already recorded');
  assert.equal(named(card, 'Decline'), undefined);
  assert.match(card.textContent, /Your decisionapproved c1/);
});

test('failed approval and failed inbox refresh remain retryable without bypassing inactive or expired owner state', async () => {
  dom(); let active = true, gets = 0, posts = 0, getStatus = 200;
  const data = inbox([task()]);
  const f = async (url, init) => {
    if (init.method === 'POST') { posts++; getStatus = 503; return response(503, {error: 'temporary_failure'}); }
    gets++;
    return getStatus === 200 ? response(200, data) : response(getStatus, {error: getStatus === 401 ? 'owner_session_required' : 'temporary_failure'});
  };
  const card = ownerInboxCard(() => {}, f, () => active); await flush();
  named(card, 'Approve the chosen candidate').onclick(); await flush(); await flush();
  assert.match(card.textContent, /not updating/);
  const approve = named(card, 'Approve the chosen candidate');
  assert.equal(approve.disabled, false, 'a failed GET must not leave retry controls locked');
  active = false; const before = {gets, posts};
  approve.onclick(); await card.refresh(); await flush();
  assert.deepEqual({gets, posts}, before, 'inactive/replay refuses both retry POST and refresh GET');
  active = true; getStatus = 401; await card.refresh();
  assert.equal(named(card, 'Approve the chosen candidate'), undefined);
  assert.equal(named(card, 'Decline'), undefined);
  assert.match(card.textContent, /Start the owner session/);
});

test('personal meetup names are literal and profile-only refresh preserves candidate editor and focus',async()=>{dom();let display='<img src=x onerror=alert(1)>';const data=inbox([task('task_pm',{muse:'pm_me',other:'pm_other'})]);const card=ownerInboxCard(()=>{},async()=>response(200,data),()=>true,id=>id==='pm_other'?display:'Own Muse');await flush();assert.ok(card.textContent.includes('Own Muse with '+display));assert.equal(card.querySelectorAll('img').length,0);const choice=card.querySelectorAll('input[type=radio]')[1];choice.checked=true;choice.focus();display='Updated personal name';await card.refresh();assert.ok(card.textContent.includes('Own Muse with Updated personal name'));assert.equal(card.querySelectorAll('input[type=radio]')[1],choice);assert.equal(document.activeElement,choice);});
test('unknown personal peer is a safe unavailable name rather than a resident harness',async()=>{dom();const card=ownerInboxCard(()=>{},async()=>response(200,inbox([task('task_unknown',{other:'pm_unknown'})])));await flush();assert.ok(card.textContent.includes('Unknown Muse · pm_unknown'));assert.doesNotMatch(card.textContent,/Resident Muse/);});

const ownerSession=()=>({principal:'owner',ownerId:'owner',label:'Owner',demo:false,expiresAt:Date.now()+3600000});
test('anonymous session preflight prevents inbox calls across periodic refresh and remount',async()=>{dom();const calls=[];const f=async u=>{calls.push(u);return response(200,{owner:null});};const card=ownerInboxCard(()=>{},f);await flush();for(let i=0;i<3;i++)await card.refresh();assert.deepEqual(calls,['/api/owner/session']);ownerInboxCard(()=>{},f);await flush();assert.equal(calls.filter(u=>u==='/api/owner/inbox').length,0);});
test('one inbox401 stops polling until an explicit current owner session resumes it',async()=>{dom();const calls=[];let signedIn=false;const f=async u=>{calls.push(u);return u==='/api/owner/session'?response(200,{owner:ownerSession()}):signedIn?response(200,inbox([task()])):response(401,{error:'owner_session_required'});};const card=ownerInboxCard(()=>{},f);await flush();for(let i=0;i<3;i++)await card.refresh();assert.equal(calls.filter(u=>u==='/api/owner/inbox').length,1);signedIn=true;card.setOwnerSession(ownerSession());await flush();assert.equal(calls.filter(u=>u==='/api/owner/inbox').length,2);assert.ok(named(card,'Approve the chosen candidate'));});
test('logout fences an old inbox answer and removes private controls immediately',async()=>{dom();let release;const pending=new Promise(r=>release=r);const card=ownerInboxCard(()=>{},async u=>u==='/api/owner/session'?response(200,{owner:ownerSession()}):pending);await flush();card.setOwnerSession(null);release(response(200,inbox([task('task_late')])));await flush();assert.equal(named(card,'Approve the chosen candidate'),undefined);assert.match(card.textContent,/Start the owner session/);await card.refresh();assert.equal(named(card,'Approve the chosen candidate'),undefined);});
test('a late401 from the previous session cannot suppress a new logged-in session',async()=>{dom();let release,n=0;const card=ownerInboxCard(()=>{},async u=>u==='/api/owner/session'?response(200,{owner:ownerSession()}):++n===1?new Promise(r=>release=r):response(200,inbox([task()])));await flush();card.setOwnerSession(null);card.setOwnerSession({...ownerSession(),ownerId:'new-owner'});await flush();release(response(401,{error:'owner_session_required'}));await flush();assert.ok(named(card,'Approve the chosen candidate'));});
test('replay invalidation and dispose suppress late answers and subsequent reads',async()=>{dom();let active=true,release,calls=0;const card=ownerInboxCard(()=>{},async u=>{calls++;return u==='/api/owner/session'?response(200,{owner:ownerSession()}):new Promise(r=>release=r);},()=>active);await flush();active=false;await card.refresh();active=true;release(response(200,inbox([task('task_late')])));await flush();assert.equal(named(card,'Approve the chosen candidate'),undefined);card.dispose();const before=calls;await card.refresh();assert.equal(calls,before);});
test('owner session expiry stops refresh without issuing another inbox or session call',async()=>{dom();const original=Date.now;let clock=original(),calls=0;Date.now=()=>clock;try{const card=ownerInboxCard(()=>{},async u=>{calls++;return u==='/api/owner/session'?response(200,{owner:{...ownerSession(),expiresAt:clock+1000}}):response(200,inbox([task()]));});await flush();const before=calls;clock+=1001;await card.refresh();assert.equal(calls,before);assert.equal(named(card,'Approve the chosen candidate'),undefined);}finally{Date.now=original;}});
test('real owner control callbacks resume after login and stop before pending logout settles',async()=>{dom();let signedIn=false,finishLogout;const calls=[];globalThis.fetch=async(u,i)=>{calls.push({u,method:i.method});if(u==='/api/owner/session'){if(i.method==='POST')signedIn=true;if(i.method==='DELETE')return new Promise(r=>finishLogout=()=>{signedIn=false;r(response(200,{ok:true}));});return response(200,{owner:signedIn?{...ownerSession(),muses:['00-jolly']}:null,delegation:[]});}return response(200,inbox([task()]));};const card=ownerInboxCard(()=>{},globalThis.fetch),control=ownerControlCard(()=>{},undefined,owner=>card.setOwnerSession(owner));await flush();assert.equal(calls.filter(r=>r.u==='/api/owner/inbox').length,0);control.querySelector('input[type=password]').value='synthetic-local-test';await named(control,'Start owner session').onclick();await flush();assert.equal(calls.filter(r=>r.u==='/api/owner/inbox').length,1);assert.ok(named(card,'Approve the chosen candidate'));const pending=named(control,'End owner session').onclick();assert.equal(named(card,'Approve the chosen candidate'),undefined);const before=calls.length;await card.refresh();assert.equal(calls.length,before);finishLogout();await pending;await card.refresh();assert.equal(calls.filter(r=>r.u==='/api/owner/inbox').length,1);});
test('simultaneous periodic refresh coalesces one pending inbox GET',async()=>{dom();let release,inboxes=0;const card=ownerInboxCard(()=>{},async u=>u==='/api/owner/session'?response(200,{owner:ownerSession()}):(inboxes++,new Promise(r=>release=r)));await flush();const a=card.refresh(),b=card.refresh();assert.equal(inboxes,1);release(response(200,inbox([task()])));await Promise.all([a,b]);assert.ok(named(card,'Approve the chosen candidate'));});
test('failed or invalid session preflight never tries the protected inbox or polls automatically',async()=>{for(const mode of['network','503','malformed']){dom();const calls=[];const card=ownerInboxCard(()=>{},async u=>{calls.push(u);if(mode==='network')throw Error('synthetic network');return mode==='503'?response(503,{}):response(200,{owner:{label:'missing binding'}});});await flush();await card.refresh();await card.refresh();assert.deepEqual(calls,['/api/owner/session']);assert.equal(named(card,'Approve the chosen candidate'),undefined);}});
