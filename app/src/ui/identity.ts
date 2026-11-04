import {apiFetch,apiFetcher} from './api-fetch.ts';
import {uiText} from './i18n.ts';
// Owner control UI (direction v2, 7 "철회"; contract C06; I-02). Revoking a Muse's delegation and delegating again are
// owner actions: ordinary UI uses only the current Threads personal session bound to ComBba.
// The emergency token endpoint remains server-side and is never offered or exchanged by this card.
// Everything is built with textContent; nothing from the server is parsed as HTML.
import {resolveMuse} from './personal-profile.ts';
import {personalOwnerAccess, type createPersonalOwnerAccess} from './personal-owner.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const at = (ms: number) => new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(ms));
const defaultName = (id: string) => resolveMuse({id}).name;

type OwnerView = {principal: string; ownerId: string; label: string; demo: boolean; note: string; muses: string[]; expiresAt: number};
type Delegation = {muse: string; status: 'active' | 'revoked'; version: number | null; paused: {at: number; by: string} | null; pendingTasks: number};
type SessionAnswer = {owner: OwnerView | null; delegation?: Delegation[]};

const REASONS: Record<string, string> = {
  owner_session_required: uiText('The owner session ended. Start it again.'),
  owner_token_invalid: uiText('That is not an owner control token. Nothing changed.'),
  not_your_muse: uiText('This owner session does not control that Muse. Nothing changed.'),
  origin_not_allowed: uiText('Refused: the request did not come from this site. Nothing changed.'),
  not_configured: uiText('Owner control is not configured on this deployment yet.'),
  slow_down: uiText('Too many attempts. Wait a minute and try again.'),
};
async function call(f: typeof fetch, method: string, path: string, body?: unknown): Promise<{ok: boolean; status: number; data: any}> {
  try {
    const r = await apiFetcher(f)(path, {method, cache: 'no-store', headers: body === undefined ? {} : {'content-type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
    return {ok: r.ok, status: r.status, data: await r.json().catch(() => null)};
  } catch {
    return {ok: false, status: 0, data: {error: 'network'}};
  }
}
const why = (r: {status: number; data: any}) => REASONS[r.data?.error] ?? (r.status ? uiText`HTTP ${r.status}${r.data?.error ? ' · ' + r.data.error : ''}` : uiText('network error'));

/** The owner control card for the Identity tab. `onChange` refreshes the world view after a revoke or a re-delegation. */
export function ownerControlCard(onChange: () => void, name: (id:string)=>string = defaultName, onSession?: (owner: OwnerView | null) => void, options: {access?: ReturnType<typeof createPersonalOwnerAccess>} = {}) {
  const access=options.access??personalOwnerAccess, box=el('div','id-card owner-control'),result=el('p','muted');result.setAttribute('role','status');
  const head=()=>el('span','eyebrow',uiText('내 Muse 관리 / My Muse controls'));
  let generation=0,disposed=false;
  const publish=(owner:OwnerView|null)=>{try{onSession?.(owner);}catch{}};
  function signedOut(){
    const open=el('button','secondary',uiText('Threads로 로그인 / Sign in with Threads'));open.type='button';open.onclick=()=>document.getElementById('entry-open')?.click();
    box.replaceChildren(head(),el('h4','',uiText('내 Muse 계정으로 로그인하세요 / Sign in with your Muse’s account')),el('p','muted',uiText('ComBba에 연결한 Threads 계정으로 로그인하면 주인 기능을 사용할 수 있어요. / Sign in with the Threads account connected to ComBba to use its owner controls.')),open,result);
  }
  function clear(){if(disposed)return;generation++;publish(null);result.textContent='';signedOut();}
  async function paint(){
    if(disposed)return;const mine=++generation,r=await call(access.fetch,'GET','/api/owner/session');if(disposed||mine!==generation)return;
    if(!r.ok||!r.data?.owner){publish(null);signedOut();if(r.status!==401)result.textContent=uiText('주인 상태를 확인하지 못했어요. 문에서 개인 로그인을 확인해 주세요. / Could not check owner access. Check your personal sign-in at the door.');return;}
    const s=r.data as SessionAnswer,o=s.owner!;publish(o);const dl=el('dl','facts');dl.append(el('dt','',uiText('Signed in as')),el('dd','',o.label.endsWith(' · owner')?o.label.slice(0,-8):name('00-jolly')),el('dt','',uiText('Session ends')),el('dd','',at(o.expiresAt)));const parts:HTMLElement[]=[head(),el('h4','',uiText('내 Muse 관리 / My Muse controls')),dl];
    const current=()=>!disposed&&generation===mine;
    for(const d of s.delegation??[]){
      if(d.muse!=='00-jolly')continue;
      const facts=el('dl','facts');facts.append(el('dt','',uiText('Muse')),el('dd','',name(d.muse)),el('dt','',uiText('Delegation')),el('dd','',d.status==='active'?uiText`Active (version ${d.version??'?'})`:uiText`Revoked (version ${d.version??'?'})`));const actions=el('div','id-actions');
      const b=el('button','secondary',d.status==='active'?uiText`Revoke ${name(d.muse)}'s delegation`:uiText`Delegate ${name(d.muse)} again`);b.type='button';b.onclick=async()=>{
        if(!current()||b.disabled)return;if(d.status==='active'&&!window.confirm(uiText`Revoke ${name(d.muse)}'s delegation? Its pending Tasks are cancelled and it stops in the world until you delegate again. Nothing delegates it again by itself.`))return;
        b.disabled=true;const r=await call(access.fetch,'POST',d.status==='active'?'/api/owner/revoke':'/api/owner/redelegate',{muse:d.muse});if(!current())return;result.textContent=r.ok?uiText('설정을 바꿨어요. / Settings updated.'):why(r);await paint();if(!disposed)onChange();
      };actions.append(b);parts.push(facts,actions);
    }
    const out=el('button','secondary',uiText('로그아웃 / Sign out'));out.type='button';out.dataset.action='owner-logout';out.onclick=async()=>{if(!current())return;const r=await call(access.fetch,'DELETE','/api/owner/session');if(disposed)return;result.textContent=r.ok?uiText('로그아웃했어요. 계속 관람할 수 있어요. / Signed out. You can keep watching.'):uiText('로그아웃을 확인하지 못했어요. 문에서 다시 확인해 주세요. / Sign-out could not be confirmed. Check again at the door.');if(r.ok)onChange();};parts.push(out,result);box.replaceChildren(...parts);
  }
  const unsubscribe=access.subscribe(reason=>{if(reason==='available')void paint();else clear();});
  box.append(head(),el('p','muted',uiText('Checking the owner session…')));void paint();
  return Object.assign(box,{refresh:paint,clear,dispose(){if(disposed)return;generation++;disposed=true;unsubscribe();publish(null);box.replaceChildren();}});
}

/** One sentence for a P0 step answer (/api/p0/run). P0 never revokes or delegates; the owner does. */
export function p0Text(j: any): string {
  if (j?.phase === 'valid') return j.ok ? uiText('Step 1 done: the signed request passed every check and the trade committed. Next, the owner revokes the delegation (owner control above), then run P0 again.') : uiText`Step 1 did not commit (${String(j.before ?? j.reason ?? 'unknown').replace(/_/g, ' ')}). Nothing to revoke against yet.`;
  if (j?.phase === 'after_revoke') return j.afterRevoke === 'delegation_revoked' ? uiText`Refused: delegation revoked. The same job was signed again with a new nonce; the world did not change${j.stateUnchanged ? '' : uiText(' (check the Feed)')}. It stays refused until the owner delegates again.` : uiText`After the revocation: ${String(j.afterRevoke ?? j.reason).replace(/_/g, ' ')}.`;
  return uiText('Done. The result is in the Feed and Highlights.');
}
