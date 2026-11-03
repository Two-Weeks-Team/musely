/** Life-01 opt-in data/proposal module. No timers, IO, model calls or world mutations.
 * The existing heartbeat/visitor queue/budget and command authority remain authoritative.
 * Never treat a proposal or memory claim as an executed action.
 */
export type Provenance = 'rule' | 'live' | 'scripted' | 'replay';
export type LifeRole = {id: string; defaultGoal: string; home: string};
export type Routine = {hour: number; place: string};
export type Memory = {id: string; kind: 'declared' | 'inferred' | 'agreement' | 'executed';
  at: number; subject: string; publicSummary: string; source: Provenance; evidenceId: string};
export type PromiseRecord = {id: string; other: string; place: string; dueAt: number;
  status: 'pending' | 'fulfilled' | 'cancelled'; evidenceId: string};
export type ResidentLife = {id: string; roleId: string; goal: string; routine: Routine[];
  memories: Memory[]; promises: PromiseRecord[]; lastServedAt: number; served: number};
export type LifeState = {schema: 1; residents: ResidentLife[]};
export type ActorAuthority = {id: string; connected: boolean; paused: boolean};
export type ProposalContext = {now:number;hour:number;worldVersion:number;
  authorities:readonly ActorAuthority[];allowedPlaceIds:readonly string[];residentTurnAllowed:boolean;
  /** Caller-selected planning horizon, milliseconds; default 0 = due now only. */
  promiseLeadMs?:number;promiseGraceMs?:number};
export type LifeProposal = {residentId: string; placeId: string; reason: 'promise' | 'routine';
  promiseId?: string; source: 'rule'; expectedWorldVersion: number};
const MAX_RESIDENTS = 100, MAX_MEMORIES = 64, MAX_PROMISES = 32;
const sources: Provenance[] = ['rule', 'live', 'scripted', 'replay'];
const kinds: Memory['kind'][] = ['declared', 'inferred', 'agreement', 'executed'];
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const str = (s: unknown, max = 160): s is string => typeof s === 'string' && s.length > 0 && s.length <= max && !/[\u0000-\u001f<>]/.test(s);
const unique = (xs: string[]) => new Set(xs).size === xs.length;
const fail = () => {throw new Error('invalid resident life state');};

/** Strict restore validates bounded data. It does not load private personal-Muse memory. */
export function restoreLife(raw: string): LifeState {
  if (raw.length > 2_000_000) fail();
  const s = JSON.parse(raw) as LifeState;
  if (!s || s.schema !== 1 || !Array.isArray(s.residents) || s.residents.length > MAX_RESIDENTS) fail();
  for (const r of s.residents) {
    if (!r || !str(r.id) || !str(r.roleId) || !str(r.goal) || !finite(r.lastServedAt) || !Number.isSafeInteger(r.served) || r.served < 0) fail();
    if (!Array.isArray(r.routine) || r.routine.length > 24 || !r.routine.every(x => x && Number.isInteger(x.hour) && x.hour >= 0 && x.hour < 24 && str(x.place)) || !unique(r.routine.map(x => String(x.hour)))) fail();
    if (!Array.isArray(r.memories) || r.memories.length > MAX_MEMORIES) fail();
    for (const m of r.memories) if (!m || !str(m.id) || !kinds.includes(m.kind) || !finite(m.at) || !str(m.subject) || !str(m.publicSummary) || !sources.includes(m.source) || !str(m.evidenceId)) fail();
    if (!unique(r.memories.map(m => m.id))) fail();
    if (!Array.isArray(r.promises) || r.promises.length > MAX_PROMISES) fail();
    for (const p of r.promises) if (!p || !str(p.id) || !str(p.other) || !str(p.place) || !finite(p.dueAt) || !['pending','fulfilled','cancelled'].includes(p.status) || !str(p.evidenceId)) fail();
    if (!unique(r.promises.map(p => p.id))) fail();
  }
  if (!unique(s.residents.map(r => r.id))) fail();
  // Rebuild allowlisted fields: unknown fields (including private data) never survive.
  return {schema: 1, residents: s.residents.map(r => ({id:r.id,roleId:r.roleId,goal:r.goal,
    lastServedAt:r.lastServedAt,served:r.served,routine:r.routine.map(x=>({hour:x.hour,place:x.place})),
    memories:r.memories.map(m=>({id:m.id,kind:m.kind,at:m.at,subject:m.subject,publicSummary:m.publicSummary,source:m.source,evidenceId:m.evidenceId})),
    promises:r.promises.map(p=>({id:p.id,other:p.other,place:p.place,dueAt:p.dueAt,status:p.status,evidenceId:p.evidenceId}))}))};
}
export const saveLife = (state: LifeState): string => JSON.stringify(restoreLife(JSON.stringify(state)));

/** Role templates are not actor IDs. Caller maps only existing resident actors initially. */
export function createLife(roles: readonly LifeRole[], instances: readonly {id:string;roleId:string;routine?:Routine[]}[]): LifeState {
  if (!unique(roles.map(r=>r.id))) fail();
  const residents = instances.map(i => {
    const role = roles.find(r=>r.id === i.roleId); if (!role) throw new Error('unknown role');
    return {id:i.id,roleId:role.id,goal:role.defaultGoal,routine:i.routine ?? [{hour:0,place:role.home}],
      memories:[],promises:[],lastServedAt:0,served:0};
  });
  return restoreLife(JSON.stringify({schema:1,residents}));
}

/** Idempotent evidence memory. No numeric trust score or automatic goal completion. */
export function remember(state: LifeState, id: string, memory: Memory): LifeState {
  const next = restoreLife(saveLife(state)); const r = next.residents.find(r=>r.id===id);
  if (!r) throw new Error('unknown resident');
  const existing = r.memories.find(m=>m.id===memory.id);
  if (existing) {if (!(['id','kind','at','subject','publicSummary','source','evidenceId'] as const).every(k=>existing[k]===memory[k])) throw new Error('memory conflict'); return next;}
  r.memories.push(memory); r.memories = r.memories.slice(-MAX_MEMORIES);
  return restoreLife(JSON.stringify(next));
}
export function recordPromise(state:LifeState,id:string,promise:PromiseRecord):LifeState {
  const next=restoreLife(saveLife(state)); const r=next.residents.find(r=>r.id===id);
  if (!r) throw new Error('unknown resident');
  const old=r.promises.find(p=>p.id===promise.id);
  if(old) {if(!(['id','other','place','dueAt','status','evidenceId'] as const).every(k=>old[k]===promise[k])) throw new Error('promise conflict'); return next;}
  // Never evict a pending promise to accept a new one.
  if(r.promises.length>=MAX_PROMISES) throw new Error('promise capacity');
  r.promises.push(promise); return restoreLife(JSON.stringify(next));
}

/** Adapter supplies trusted actor authority and allowed places from the latest world snapshot.
 * Returns data only; caller must revalidate at execution. Missing actors fail closed.
 * Existing visitor/model budget decisions happen BEFORE calling this helper.
 */
export function proposeLifeTurn(state:LifeState, input:ProposalContext):LifeProposal|null {
  if(!finite(input.now)||!Number.isInteger(input.hour)||input.hour<0||input.hour>23||!Number.isSafeInteger(input.worldVersion)||input.worldVersion<0) throw new Error('invalid clock/version');
  const lead=input.promiseLeadMs ?? 0;
  if(!finite(lead)||lead>86_400_000) throw new Error('invalid promise planning horizon');
  const grace=input.promiseGraceMs ?? 0;
  if(!finite(grace)||grace>86_400_000) throw new Error('invalid promise grace');
  if(input.residentTurnAllowed!==true) return null;
  if(!unique(input.authorities.map(a=>a.id))) throw new Error('duplicate actor authority');
  const valid=restoreLife(saveLife(state)).residents.filter(r=>{
    const a=input.authorities.find(a=>a.id===r.id); return a && a.connected===false && a.paused===false;
  }).sort((a,b)=>a.lastServedAt-b.lastServedAt || a.served-b.served || a.id.localeCompare(b.id));
  for(const r of valid){
    const p=r.promises.filter(p=>p.status==='pending' && p.dueAt>=input.now-grace && p.dueAt-input.now<=lead && input.allowedPlaceIds.includes(p.place)).sort((a,b)=>a.dueAt-b.dueAt)[0];
    const routine=[...r.routine].sort((a,b)=>a.hour-b.hour);
    const slot=routine.filter(x=>x.hour<=input.hour).at(-1) ?? routine.at(-1);
    const place=p?.place ?? slot?.place;
    if(!place||!input.allowedPlaceIds.includes(place)) continue;
    return {residentId:r.id,placeId:place,reason:p?'promise':'routine',...(p?{promiseId:p.id}:{}),source:'rule',expectedWorldVersion:input.worldVersion};
  }
  return null;
}
/** Called only after the existing scheduler records this resident's attempted turn.
 * Does not assert movement, promise fulfillment, or model success. */
export function noteServed(state:LifeState,id:string,now:number):LifeState {
  const next=restoreLife(saveLife(state));const r=next.residents.find(r=>r.id===id);
  if(!r||!finite(now)||now<r.lastServedAt) throw new Error('invalid served timestamp');
  r.lastServedAt=now;r.served++;return restoreLife(JSON.stringify(next));
}

/** Receipt-driven promise closure. Caller must supply an already-authoritative event.
 * This function is not an authorization/authenticity verifier and must stay server-side.
 */
export function closePromise(state:LifeState,id:string,promiseId:string,status:'fulfilled'|'cancelled',evidence:Memory):LifeState {
  if(evidence.kind!=='executed') throw new Error('execution evidence required');
  const next=remember(state,id,evidence);const r=next.residents.find(r=>r.id===id)!;
  const p=r.promises.find(p=>p.id===promiseId);
  if(!p) throw new Error('unknown promise');
  if(p.status!=='pending') {if(p.status!==status||p.evidenceId!==evidence.evidenceId) throw new Error('promise already closed');return next;}
  p.status=status;p.evidenceId=evidence.evidenceId;return restoreLife(JSON.stringify(next));
}

/** Defense-in-depth validation for a queued rule proposal against a fresh snapshot.
 * Pure predicate, not an execution permit. The real command authority still validates
 * identity, permissions, consent, reachable routes and atomic state/version at commit.
 */
export function isCurrentLifeProposal(state:LifeState,proposal:LifeProposal,input:ProposalContext):boolean {
  if(proposal.source!=='rule'||proposal.expectedWorldVersion!==input.worldVersion) return false;
  const current=proposeLifeTurn(state,input);
  return current!==null && current.residentId===proposal.residentId && current.placeId===proposal.placeId
    && current.reason===proposal.reason && current.promiseId===proposal.promiseId;
}
