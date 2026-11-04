import {isAppearance,normalizeAppearance,appearanceLook,appearanceKey,type AppearanceId} from '../character-kit/appearance.ts';
import {apiFetcher} from './api-fetch.ts';
import {uiText,catalogText,inventoryText,activityStatus} from './i18n.ts';
// Profile preparation only: never proves world entry and is not mounted by the live door yet.
import {MUSE_VARIANTS} from '../character-kit/catalog.ts';
import type {ActorProfile} from '../identity/participant.ts';

export type PersonalEntryPhase = 'observer' | 'authenticated' | 'pending' | 'registered' | 'error';
export type PersonalEntryState = {phase: PersonalEntryPhase; authenticated: boolean | null; profile: ActorProfile | null; busy: boolean; joined: false};
export type PersonalEntryOptions = {authResult?: string;onWatch?:()=>void;connectionManaged?: boolean; onState?: (state: PersonalEntryState) => void; fetcher?: typeof fetch; navigate?: (url: string) => void | Promise<void>; newOperationId?: () => string; now?: () => number};
// Only classify presence: provider query values never become UI text or diagnostics.
export function personalAuthResult(query?:URLSearchParams):string|undefined {
 if(query?.has('error')||query?.has('error_reason'))return 'failed';
 const result=query?.get('personal');return ['authenticated','failed','declined'].includes(result??'')?result!:undefined;
}
export function signInStartFailure(status:number,invalid=false):string {
 if(status===429)return uiText('로그인 요청이 많아요. 잠시 기다린 뒤 다시 시도해 주세요. / Too many sign-in requests. Please wait a moment and try again.');
 if(status===403)return uiText('이 주소에서는 로그인을 열 수 없어요. https://musely.net을 직접 열어 주세요. / Sign-in cannot open from this address. Open https://musely.net directly.');
 if(status>=500)return uiText('로그인 서버에 잠시 문제가 있어요. 잠시 뒤 다시 시도해 주세요. / The sign-in server is temporarily unavailable. Please try again later.');
 if(invalid||status>=400)return uiText('로그인 응답을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요. / The sign-in response could not be confirmed. Please try again later.');
 return uiText('네트워크 연결을 확인하고 다시 시도해 주세요. / Check your network connection and try again.');
}
class Failure extends Error { readonly status: number; readonly invalid: boolean; constructor(status = 0, invalid = false) { super('personal_entry_unavailable'); this.status = status; this.invalid = invalid; } }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const entry = (v: unknown, state: string) => exact(v, ['state']) && v.state === state;
const publicName = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && [...v.trim()].length <= 40 && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(v);
const appearance = (v: unknown) => MUSE_VARIANTS.find(x => x.id === v);
function parseProfile(v: unknown): ActorProfile {
 if (!exact(v, ['actorId', 'displayName', 'appearanceId', 'revision']) || typeof v.actorId !== 'string' || !(/^pm_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v.actorId) || appearance(v.actorId)) || !publicName(v.displayName) || v.displayName !== v.displayName.trim() || !Number.isSafeInteger(v.revision) || Number(v.revision) < 1) throw new Failure(0, true);
 if (!isAppearance(v.appearanceId)) throw new Failure(0, true);
 return {actorId: v.actorId, displayName: v.displayName, appearanceId:normalizeAppearance(v.appearanceId),revision:Number(v.revision)};
}
function parseProfileAnswer(v: unknown): ActorProfile | null {
 if (!exact(v, ['profile', 'entry'])) throw new Failure(0, true);
 if (v.profile === null) { if (!entry(v.entry, 'viewing')) throw new Failure(0, true); return null; }
 if (!entry(v.entry, 'registered')) throw new Failure(0, true);
 return parseProfile(v.profile);
}
function authorization(v: unknown): string {
 if (!exact(v, ['authorizationUrl']) || typeof v.authorizationUrl !== 'string' || !/^https:\/\/threads\.com\/oauth\/authorize(?:\?[^#]*)?$/.test(v.authorizationUrl)) throw new Failure(0, true);
 const url = new URL(v.authorizationUrl);
 if (url.origin !== 'https://threads.com' || url.pathname !== '/oauth/authorize' || url.username || url.password || url.hash) throw new Failure(0, true);
 return url.href;
}

/** Explicit mount performs me/profile reads only. All writes require the component's user controls. */
export function mountPersonalEntry(host: HTMLElement, options: PersonalEntryOptions = {}) {
 const fetcher = apiFetcher(options.fetcher), navigate = options.navigate ?? (url => window.location.assign(url));
 const now = options.now ?? Date.now, operationId = options.newOperationId ?? (() => crypto.randomUUID());
 const root = document.createElement('section'); root.className = 'personal-entry'; host.append(root);
 let phase: PersonalEntryPhase = 'pending', authenticated: boolean | null = null, profile: ActorProfile | null = null, expiresAt = 0;
 let logoutPending = false, externalBusy = false;
 let busy = false, disposed = false, generation = 0, controller: AbortController | null = null, actorBinding: string | null = null, needsRefresh = false;
 let message = uiText('Checking your profile…'), draft = {displayName: '', appearanceId: MUSE_VARIANTS[0].id as AppearanceId};
 let pendingDraft: {intent: string; operationId: string} | null = null;
 type Context = {generation: number; controller: AbortController};
 const current = (c: Context) => !disposed && generation === c.generation && !c.controller.signal.aborted;
 const state = (): PersonalEntryState => ({phase, authenticated, profile:profile?structuredClone(profile):null, busy, joined: false});
 const resetProfile = (keepOperation = false) => { profile = null; draft = {displayName: '', appearanceId: MUSE_VARIANTS[0].id}; if (!keepOperation) pendingDraft = null; };
 const signedOut = (text = uiText('Keep watching, or sign in to prepare your own Muse.')) => { authenticated = false; expiresAt = 0; actorBinding = null; resetProfile(); needsRefresh = false; phase = 'observer'; busy = false; message = text; };
 const usable = () => { if (authenticated === true && expiresAt > now()) return true; signedOut(uiText('Your session ended. You can keep watching or sign in again.')); render(); return false; };
 function begin(text: string, force = false): Context | null {
  if (disposed || externalBusy || busy && !force) return null;
  controller?.abort(); controller = new AbortController(); generation++; busy = true; phase = 'pending'; message = text; render();
  return {generation, controller};
 }
 async function request(path: string, method: string, c: Context, body?: unknown): Promise<unknown> {
  const timeout = setTimeout(() => c.controller.abort(), 12000);
  try {
   const r = await fetcher(path, {method, mode: 'same-origin', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: c.controller.signal, ...(body === undefined ? {} : {headers: {'content-type': 'application/json'}, body: JSON.stringify(body)})});
   if (!r.ok) throw new Failure(r.status);
   if (r.redirected) throw new Failure(0, true);
   let data: unknown; try { data = await r.json(); } catch { throw new Failure(0, true); }
   if (c.controller.signal.aborted) throw new Failure(); return data;
  } finally { clearTimeout(timeout); }
 }
 function fail(error: unknown, c: Context, text: string, uncertain = false) {
  // Abort caused by refresh/dispose belongs to the old generation. A timeout in the current one still shows an error.
  if (disposed || generation !== c.generation) return;
  busy = false;
  if (error instanceof Failure && error.status === 401) signedOut(uiText('Your session ended. Sign in again when you are ready.'));
  else { phase = 'error'; needsRefresh = uncertain || error instanceof Failure && (error.invalid || error.status === 409); message = error instanceof Failure && error.status === 409 ? uiText('Your profile changed. Refresh before saving again.') : text; }
  render();
 }
 function accept(p: ActorProfile | null) {
  if (actorBinding && (!p || p.actorId !== actorBinding)) throw new Failure(0, true);
  profile = p;
  if (p) { actorBinding = p.actorId; pendingDraft = null; draft = {displayName: p.displayName, appearanceId: p.appearanceId}; }
  else draft = {displayName: '', appearanceId: MUSE_VARIANTS[0].id};
 }
 async function refresh() {
  if (disposed || logoutPending || externalBusy) return;
  // Keep an unconfirmed operation across read-only checks; logout/dispose/signed-out always discard it.
  authenticated = null; expiresAt = 0; resetProfile(true); needsRefresh = false;
  const c = begin(uiText('Checking your profile…'), true)!;
  try {
   const me = await request('/api/personal/me', 'GET', c); if (!current(c)) return;
   if (!object(me) || typeof me.authenticated !== 'boolean' || !entry(me.entry, 'viewing') || !exact(me, me.authenticated ? ['authenticated', 'expiresAt', 'entry'] : ['authenticated', 'entry'])) throw new Failure(0, true);
   if (!me.authenticated) { signedOut(); render(); return; }
   if (!Number.isSafeInteger(me.expiresAt) || Number(me.expiresAt) <= now()) { signedOut(uiText('Your session ended. Sign in again when you are ready.')); render(); return; }
   authenticated = true; expiresAt = Number(me.expiresAt);
   const answer = await request('/api/personal/profile', 'GET', c); if (!current(c)) return;
   if (!usable()) return;
   accept(parseProfileAnswer(answer)); phase = profile ? 'registered' : 'authenticated'; busy = false; message = ''; render();
  } catch (e) { fail(e, c, uiText('Could not check your profile. Refresh to try again.'), true); }
 }
 async function login() {
  const c = begin(uiText('Opening Threads sign-in…')); if (!c) return;
  try {
   const answer = await request('/api/personal/auth/threads/start', 'POST', c); if (!current(c)) return;
   const url = authorization(answer); await navigate(url); if (!current(c)) return;
   // Navigation is pending, not authentication/entry success. Refresh on return/remount, never a timer.
   message = uiText('Continue in Threads, then return here to check your profile.'); render();
  } catch (e) { fail(e,c,signInStartFailure(e instanceof Failure?e.status:0,e instanceof Failure&&e.invalid)); }
 }
 async function save(nameInput: string, appearanceInput: AppearanceId) {
  if (disposed || busy || externalBusy || needsRefresh || !usable()) return;
  draft = {displayName: nameInput, appearanceId: appearanceInput};
  if (!publicName(nameInput) || !isAppearance(appearanceInput)) { phase = 'error'; message = uiText('Use a public name of 1–40 characters and choose an appearance.'); render(); return; }
  const name=nameInput.trim(),selectedAppearance=normalizeAppearance(appearanceInput);
  const previous = profile ? {...profile} : null;
  const intent = JSON.stringify([name,appearanceKey(selectedAppearance)]);
  if (!previous && pendingDraft?.intent !== intent) {
   try { const id = operationId(); if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || id.startsWith('msly_')) throw new Failure(); pendingDraft = {intent, operationId: id}; }
   catch { phase = 'error'; message = uiText('Could not prepare your profile. Please try again.'); render(); return; }
  }
  const body = previous ? {expectedRevision: previous.revision, displayName: name, ...(appearanceKey(previous.appearanceId)===appearanceKey(selectedAppearance) ? {} : {appearanceId:selectedAppearance})} : {operationId: pendingDraft!.operationId, displayName: name, appearanceId:selectedAppearance};
  const c = begin(previous ? uiText('Saving your profile…') : uiText('Registering your profile…')); if (!c) return;
  try {
   const answer = await request(previous ? '/api/personal/profile' : '/api/personal/draft', previous ? 'PATCH' : 'POST', c, body); if (!current(c)) return;
   if (!usable()) return;
   const p = parseProfileAnswer(answer);
   // A repeated draft operation returns the server's current profile, including later edits in another window.
   if (!p || previous && (p.actorId !== previous.actorId || p.revision !== previous.revision + 1 || p.displayName !== name || appearanceKey(p.appearanceId)!==appearanceKey(selectedAppearance))) throw new Failure(0, true);
   accept(p); pendingDraft = null; phase = 'registered'; busy = false; message = ''; render();
  } catch (e) { fail(e, c, uiText('Could not confirm the profile change. Try again or refresh.')); }
 }
 async function logout() {
  const c = begin(uiText('Signing out…')); if (!c) return;
  // A sent logout can still commit after a client abort. Reads cannot supersede it while pending.
  logoutPending = true; authenticated = null; resetProfile(); render();
  try {
   const result = await request('/api/personal/session', 'DELETE', c); if (!current(c)) return;
   if (!exact(result, ['authenticated', 'entry']) || result.authenticated !== false || !entry(result.entry, 'viewing')) throw new Failure(0, true);
   signedOut(uiText('Signed out. You can keep watching.')); render();
  } catch (e) { if (!disposed && generation === c.generation) authenticated = null; fail(e, c, uiText('Sign out could not be confirmed. Refresh to check your session.'), true); }
  finally { logoutPending = false; if (!disposed && generation === c.generation) render(); }
 }
 function render() {
  if (disposed) return;
  root.replaceChildren(); root.dataset.state = phase; root.dataset.joined = 'false';
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
  root.append(element('h2', authenticated === true ? uiText('2 · 내 Muse 선택 / 2 · Choose your Muse') : uiText('1 · Threads로 로그인 / 1 · Sign in with Threads')));
  if (authenticated !== true) root.append(element('p', uiText('로그인 → 이름과 모습 선택 → 내 Muse가 세계에 입장 / Sign in → pick a name and look → your Muse joins the world')));
  if (options.authResult === 'failed' || options.authResult === 'declined') {
   const notice = element('p', uiText(options.authResult === 'failed' ? 'Threads 연결을 마치지 못했어요. 잠시 뒤 다시 시도하거나 계속 관람해 주세요. / We could not finish connecting Threads. Try again later, or keep watching.' : 'Threads 연결이 취소됐어요. 계속 관람하거나 준비되면 로그인해 주세요. / Threads sign-in was cancelled. Keep watching, or sign in when you are ready.'));
   notice.setAttribute('role', 'alert'); root.append(notice);
   const watch=element('button',uiText('계속 둘러보기 / Keep watching'));watch.type='button';watch.className='link-button';watch.dataset.action='watch';watch.onclick=()=>options.onWatch?.();root.append(watch);
  }
  const detail=element('details');detail.className='entry-advanced';detail.append(element('summary',uiText('이름·모습·로그인 관리 / Manage name, appearance and sign-in')));
  const normal=profile?(options.connectionManaged?uiText('이름과 모습이 준비됐어요. 연결과 입장은 아래에서 확인해 주세요. / Your name and appearance are ready. Check connection and entry below.'):uiText('이름과 모습이 준비됐어요. 아직 세계 입장 완료는 아니에요. / Your name and appearance are ready. Your Muse has not entered the world yet.')):uiText('내 Muse의 공개 이름과 모습을 골라 주세요. 관람은 로그인 없이도 할 수 있어요. / Choose your Muse’s name and appearance. You can keep watching without signing in.');
  const status = element('p', message||normal); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); root.append(status);
  const button = (action: string, text: string, fn: () => Promise<void>) => { const b = element('button', text); b.type = 'button'; b.className = 'secondary'; b.dataset.action = action; b.disabled = busy || externalBusy; b.onclick = fn; return b; };
  if (profile && authenticated) root.append(element('p', profile.displayName));
  if (authenticated === false) {const beta=element('p',uiText('베타: 초대받은 분만 로그인할 수 있어요. 관람은 누구나 바로 할 수 있어요. / Beta: sign-in is open to invited testers. Watching is open to everyone.'));beta.className='muted personal-beta-notice';root.append(beta);const b=button('login',uiText('Threads로 로그인 / Sign in with Threads'),login);b.className='primary';root.append(b);}
  if (authenticated === true && !needsRefresh) {
   const f = element('form'), label = element('label', uiText('공개할 Muse 이름 / Public Muse name')), input = element('input'); input.type = 'text'; input.name = 'displayName'; input.value = draft.displayName; input.maxLength = 80; input.disabled = busy || externalBusy; input.setAttribute('aria-label', uiText('공개할 Muse 이름 / Public Muse name')); label.append(input);
   const appearanceLabel = element('label', uiText('모습 / Appearance')), select = element('select'); select.name = 'appearanceId'; select.setAttribute('aria-label', uiText('모습 / Appearance')); select.disabled = busy || externalBusy;
   for (const v of MUSE_VARIANTS) { const option = element('option', v.name); option.value = v.id; select.append(option); }
   select.value=appearanceLook(draft.appearanceId); appearanceLabel.append(select);
   const submit = element('button', profile ? uiText('이름·모습 저장 / Save name and appearance') : uiText('내 Muse 만들기 / Create my Muse')); submit.type = 'submit'; submit.className = profile?'secondary':'primary'; submit.disabled = busy || externalBusy;
   f.onsubmit = async event => { event.preventDefault();const selected=MUSE_VARIANTS.find(v=>v.id===select.value);if(!selected){phase='error';message=uiText('Use a public name of 1–40 characters and choose an appearance.');render();return;}await save(input.value,appearanceLook(draft.appearanceId)===selected.id?draft.appearanceId:selected.id); }; f.append(label, appearanceLabel, submit);(profile?detail:root).append(f);
  }
  const refreshButton=button('refresh',uiText('다시 확인 / Check again'),refresh);refreshButton.disabled=logoutPending||externalBusy;
  if(needsRefresh||authenticated===null&&phase==='error'){refreshButton.className='primary';root.append(refreshButton);}else detail.append(refreshButton);
  if (authenticated === true) detail.append(button('logout', uiText('로그아웃 / Sign out'), logout));
  root.append(detail);
  try { options.onState?.(state()); } catch {}
 }

 const ready = refresh();
 return {ready,refresh,save,state,markSessionLost() { if (disposed) return; generation++; controller?.abort(); signedOut(uiText('Your session ended. Sign in again when you are ready.')); render(); }, setExternalBusy(value: boolean) { if (disposed || externalBusy === value) return; externalBusy = value; render(); }, dispose() { if (disposed) return; disposed = true; generation++; controller?.abort(); resetProfile(); authenticated = false; busy = false; actorBinding = null; try { options.onState?.(state()); } catch {} root.remove(); }};
}
