import {harnessById} from '../../src/engine/harness.ts';
import {JUDGE_MUSE} from '../../src/engine/judge-muse.ts';
import {PUBLIC_SPEECH_NOT_ENGLISH} from './resident-english-speech.ts';
import {compactResidentContext} from './resident-recovery-context.ts';
import {residentCallJitterMs} from './resident-call-jitter.ts';
import {withinConversationRange} from '../../src/engine/speech.ts';
import {perceptionView,perceptionHistory,derivedPerceptionEvents,bindPerceptionInput,observedActorId,type PerceptionPolicy} from './local-perception-runtime.ts';
import {finalizeResidentSpeech} from '../../src/engine/world.ts';
import type {PublicUtterance} from '../../src/engine/resident-utterance.ts';
import {setResidentFrozen} from '../../src/engine/world.ts';
import {isResidentInstance,harnessRoleId} from '../../src/engine/harness.ts';
import {actorProfile} from '../../src/engine/participants.ts';
// Shared-world heartbeat inside the world Durable Object (direction v2, 8.7).
// - Commit point: state, events and the tick record are written in one synchronous block; a tick that
//   is already recorded is never committed again (alarms are at-least-once and may retry).
// - Budget: the spotlight call reserves its maximum cost with a deterministic id (world:day:tick), so a
//   retried alarm cannot reserve twice; the answer settles the real cost.
// - Late answers: if the world version moved or the actor's delegation was revoked while the model was
//   thinking, the answer is logged and not executed. Timed-out calls are aborted and charged in full.
// - Every commit runs inside the storage transaction (transactionSync): a throw anywhere rolls all of it back.
// - Encounter answers (8.3, C05): after the spotlight answer, the tick is dry-run on the same state to find this tick's
//   meetings; the other Muse of each meeting answers with one model call (reserved and settled like the spotlight),
//   or by rule with the reason. The answers enter the committed tick as recorded inputs, so a dry run and the commit
//   agree unless the world moved; answers that no longer apply are logged as discarded.
// - Concurrency (C05): at most MAX_MODEL_CALLS model calls run at once per world. A call that finds no free slot
//   falls back at once (never waits); every slot is released in a finally block.
// - Run log (8.6, C08, I-10): every commit appends its inputs (model outputs, command payloads, approvals) with the
//   public state hash before and after to run-log.ts, inside the same transaction; each event row names its run and
//   input row. Reads of the log (highlight pages, period samples, one event with its commit) are below.
import {createWorld, tick, spotlightFor, spotlightInput, encounterInput, requestSpotlight, TICK_MS, type WorldState, type WorldEvent, type Decision, type EncounterReply, type Hooks} from '../../src/engine/world.ts';
import {validate, buildMessages, maxCostUsd, actualCostUsd, failureCostUsd, checkOutput} from './actions.ts';
import {recordResidentTradeRefusalsInTransaction,completeResidentGoalsInTransaction,residentGoalIdleIds,createResidentServices,runResidentGoalTurn,type ResidentGoalLoopPolicy} from './resident-goal-loop.ts';
import {runResidentWantsTurn,type ResidentWantsCallerPolicy} from './resident-wants-caller.ts';
import {callModel, type ModelConfig} from './model.ts';
import {residentKindFor,isResidentBudgetRefusal} from './resident-budget-policy.ts';
import {replayFor} from './replay.ts';
import {isRuntimeControlled, isResidentFrozen,isConnected} from '../../src/engine/inbox.ts';
import {COMMANDS_TABLE, type CommandResult} from './commands.ts';
import {syncTasks} from './tasks.ts';
import {withMessageHooks} from './messages.ts';
import type {Ledger, Sql} from './ledger.ts';
import {RunLog, evidenceIds, providerUsageEvidence, commandFields, outputFields, reasonCode, type InputKind, type CommitRecord} from './run-log.ts';
import {ResidentLifeStore, residentProposalForWorld, rememberCommittedResidentEvents, knownResident, type ResidentOwnershipKind} from './resident-life-adapter.ts';
import {enrollResidentRoster} from './resident-roster.ts';
import {residentContextForWorld, withResidentContext, type ResidentContext} from './resident-life-context.ts';
import {noteServed, restoreLife, saveLife, type LifeState} from '../../src/engine/resident-life.ts';
import {recountAutonomy, values} from './autonomy-oracle.ts';

import {residentEligible,dueResidents,decisionWorld,handoffOperatingResidents,reactionCandidates,recordDialogue,settleDialogues,type OperatingResidentControl,type SocialStatus} from './resident-activity.ts';
import {RESIDENT_ACTIVITY_SCHEMA,checkActivityOutput,activityMessages,type ResidentActivityOutput} from './resident-activity-schema.ts';
import {rememberPublicRelations,nextReflection,reflectionClock,reflectionMessages,REFLECTION_SCHEMA,checkReflectionOutput,applyReflection,type ReflectionOutput} from './resident-reflection.ts';
import {participantName} from '../../src/engine/participants.ts';
import {residentActivityCatalog} from '../../src/engine/world.ts';
import {placeById} from '../../src/engine/places.ts';
import type {ResidentReaction} from '../../src/engine/world.ts';
/** The world's SQL handle plus the Durable Object storage transaction (ctx.storage.transactionSync). */
export type TxSql = Sql & {transactionSync<T>(fn: () => T): T};
/** Repeats of one refusal inside this window collapse into its first event (the count is kept in `refusals`). */
export const REFUSAL_WINDOW_MS = 10 * 60_000;
/** C05: model calls in progress at once, per world (one Durable Object). */
export const MAX_MODEL_CALLS = 2;
/** C05: meetings per tick whose answer may be a model call (the rest answer by rule). */
export const MAX_ENCOUNTER_REPLIES = 5;
/** Meeting answers are model calls only while at least this share of the day's budget is left (the rest is kept for visitors). */
export const ENCOUNTER_BUDGET_FLOOR = 0.4;
/** After this many meeting-answer timeouts in a row, meeting answers stop calling the model for ENCOUNTER_CIRCUIT_MS. */
export const ENCOUNTER_TIMEOUTS_TO_OPEN = 3;
export const ENCOUNTER_CIRCUIT_MS = 10 * 60_000;
/** 8.2: priority spotlight requests per requester per hour (visitors: the free 3 per hour). */
export const SPOTLIGHT_REQUESTS_PER_HOUR: Record<SpotlightOrigin, number> = {visitor: 3, judge: 120, connected: 3};
export type SpotlightOrigin = 'visitor' | 'judge' | 'connected';
export type SpotlightRequestResult = {ok: true; muse: string; position: number; already: boolean; eventIds: string[]} | {ok: false; reason: 'unknown_muse' | 'paused' | 'queue_full' | 'hourly_limit' | 'self_directed' | 'model_unavailable'};

export type RuntimeOptions = {
  judgeMuseEnabled?:()=>boolean;
  perception?:PerceptionPolicy;
  residentValuesEnabled?:boolean;
  residentReflection?:{enabled:boolean;persona:(id:string)=>string};
  residentActions?:{enabled:boolean;maxConcurrent?:number;jitterMs?:number;fallbackRecovery?:boolean};
  /** Trusted test seam; production uses a bounded timer, never a new scheduler. */
  waitForResidentCall?:(ms:number)=>Promise<void>;
  operatingResidentControl?:OperatingResidentControl;
  socialStatus?:(world:WorldState,actorId:string,now:number)=>SocialStatus;
  /** Split budget controls priorities; the old shared-pool floor applies only in legacy mode. */
  residentBudgetEnabled?:boolean;
  /** Default absent/off. Trusted server-only policy; no browser-controlled flags. */
  residentLife?: {enabled:boolean;initialState:LifeState;allowedPlaceIds:readonly string[];
    /** Explicit enrollment only; never inferred from appearance or a personal profile. */
    roster?:'neighborhood-24-v1';
    ownershipKind:(id:string)=>ResidentOwnershipKind;promiseLeadMs?:number;promiseGraceMs?:number};
  residentGoals?:ResidentGoalLoopPolicy;
  /** Synchronous observer inside every successful commit transaction; throwing rolls back. */
  onCommit?:(before:WorldState,after:WorldState,events:readonly WorldEvent[],now:number)=>void;
  /** Feature OFF; server-only policy, no WorldDO installation. */
  residentWants?:ResidentWantsCallerPolicy;
  worldId: string;
  model: (Omit<ModelConfig, 'key'> & {key: string | undefined}) | null;
  ledger: Ledger;
  hooks?: Hooks;
  /** Delegation check for an actor at commit time (owner/connected Muses); residents are always valid. */
  delegationValid?: (museId: string) => boolean;
  /** Test seam: runs between the model answer and the commit (e.g. to simulate a concurrent commit). */
  beforeCommit?: () => void;
  /** Publication clock, normally wall time; recorded/test worlds inject the same clock as their commit inputs. */
  publicationNow?: () => number;
  /**
   * Checks Agent Cards and delegations before the tick (async crypto) and returns the synchronous gate the
   * engine consults before each meeting. Missing → nobody meets (fail closed); 'off' only for tests.
   */
  meetingGate: ((s: WorldState, now: number) => Promise<NonNullable<Hooks['canMeet']>>) | 'off';
};
type Emit = (e: Omit<WorldEvent, 'id' | 'tick'>) => void;
/** A stored event: its log position, run and the input row that committed it (null for events before the run log). */
export type LoggedEvent = WorldEvent & {seq: number; runId: string | null; inputSeq: number | null};
const EV_COLS = 'seq, id, tick, at, source, kind, muse, other, place, line, data, tags, run_id AS runId, input_seq AS inputSeq';
/** Largest server-side autonomy sample (a world day is about 15,000 events) and the longest period of one recount. */
export const AUTONOMY_SAMPLE_MAX = 20_000;
export const AUTONOMY_PERIOD_MAX_MS = 48 * 3_600_000;
export type CommandRow = {payloadHash: string; result: CommandResult; output: unknown};
export type HeartbeatResult = {status: 'committed' | 'skipped_duplicate' | 'skipped_early'; tick: number; events: number; spotlight?: {muse: string; source: string; reason?: string}; replies?: {live: number; rule: number}};

/** A transaction callback must finish synchronously; an async mutation would commit half-done. */
const synchronous = <T>(r: T): T => {
  if (r && typeof (r as {then?: unknown}).then === 'function') throw new Error('commit mutations must be synchronous');
  return r;
};

export class WorldRuntime {
  private sql: TxSql;
  private opts: RuntimeOptions;
  private lifeStore: ResidentLifeStore | null = null;
  /** Commands between their lookup and their commit, per actor:commandId (one DO instance runs them all). */
  readonly pending = new Set<string>();
  private slotsInUse = 0;
  /** Model calls running now (never above MAX_MODEL_CALLS). */
  private callHealth={since:Date.now(),waiting:0,active:0,peak:0,attempts:0,timeouts:0,latencies:[] as number[]};
  modelExecutionStatus(){const h=this.callHealth,sorted=[...h.latencies].sort((a,b)=>a-b),q=(p:number)=>sorted.length?sorted[Math.ceil(sorted.length*p)-1]:null;return{scope:'spotlight and encounter modelCall path since this instance started',excludedKinds:['reflection','resident_trade'],since:h.since,occupiedModelSlots:this.modelCallsInFlight,inFlight:h.active,jitterWaiting:h.waiting,peakConcurrent:h.peak,slotLimit:this.opts.residentActions?.enabled?this.opts.residentActions.maxConcurrent??4:MAX_MODEL_CALLS,attempts:h.attempts,timeouts:h.timeouts,timeoutRatio:h.attempts?h.timeouts/h.attempts:0,recentLatencyMs:{samples:sorted.length,p50:q(.5),p95:q(.95)}};}
  get modelCallsInFlight() { return this.slotsInUse; }
  /**
   * Takes one model-call slot, or null when MAX_MODEL_CALLS are already running (the caller falls back at once).
   * The returned release is idempotent; callers release it in a finally block.
   */
  modelSlot(): (() => void) | null {
    const cap=this.opts.residentActions?.enabled?this.opts.residentActions.maxConcurrent??4:MAX_MODEL_CALLS;
    if(!Number.isSafeInteger(cap)||cap<1||cap>8)throw Error('invalid_model_concurrency');
    if (this.slotsInUse >= cap) return null;
    this.slotsInUse += 1;
    let held = true;
    return () => { if (held) { held = false; this.slotsInUse -= 1; } };
  }
  /** The versioned run record and the ordered inputs of every commit (run-log.ts). */
  readonly runLog: RunLog;
  // Campfire invites close (gathered, expired, cancelled) on every tick: the invite upkeep joins the hooks here (I-13).
  private goalIdle(s:WorldState,now:number){const p=this.opts.residentGoals;if(!p||p.enabled!==true)return [];if(!this.ownsResidentGoalStore(p.goals))throw Error('resident goal storage mismatch');return residentGoalIdleIds({...p,authorize:(s,a,b,at)=>p.authorize(s,a,b,at)&&(!this.opts.delegationValid||this.opts.delegationValid(a)),ownership:id=>{const r=(this.opts as RuntimeOptions & {residentLife?:{enabled:boolean;ownershipKind:(id:string)=>'resident'|'personal'|'legacy'|'unknown'}}).residentLife;return r?.enabled?r.ownershipKind(id):'unknown';}},s,now);}

  private residentSpeechEnabled(){return this.opts.residentValuesEnabled===true||this.opts.hooks?.residentValuesEnabled===true;}
  private residentSpeechHistory(now:number):PublicUtterance[]{
    if(!Number.isFinite(now)||now<0)throw Error('invalid resident speech clock');
    // Complete time window, deliberately no public events-tail cap and no error fallback.
    return this.sql.exec('SELECT muse, at, line FROM events WHERE at >= ? AND at <= ? AND line IS NOT NULL ORDER BY seq',now-30*60_000,now).toArray() as PublicUtterance[];
  }
  private conversationHistory(now:number):NonNullable<Hooks['conversationHistory']>{
    if(!Number.isSafeInteger(now)||now<0)throw Error('invalid conversation history clock');
    // Complete authoritative window, never a public tail sample. Private greetings,
    // utterance text, reasons and inbox fields are not projected into engine hooks.
    const rows=this.sql.exec("SELECT at,kind,muse,other FROM events WHERE at >= ? AND at <= ? AND muse IS NOT NULL AND other IS NOT NULL AND muse != other AND kind IN ('encounter','greet','encounter_reply','resident_wave','resident_passby') AND (kind != 'greet' OR json_extract(data,'$.public') = 1) ORDER BY seq",now-30*60_000,now).toArray();
    return rows.map(({at,kind,muse,other})=>{
      if(typeof at!=='number'||!Number.isSafeInteger(at)||typeof muse!=='string'||typeof other!=='string'||!['encounter','greet','encounter_reply','resident_wave','resident_passby'].includes(String(kind)))throw Error('invalid conversation history row');
      if(kind!=='encounter'&&kind!=='greet'&&kind!=='encounter_reply'&&kind!=='resident_wave'&&kind!=='resident_passby')throw Error('invalid conversation history kind');
      return{at,kind,muse,other};
    });
  }
  private engineHooks(now?:number):Hooks {
    const h=this.opts.hooks??{},p=this.opts.residentGoals;
    if(p?.enabled===true&&!this.ownsResidentGoalStore(p.goals))throw Error('resident goal storage mismatch');
    return {...h,residentGreetingsEnabled:true,...(now!==undefined?{residentSpeechHistory:this.residentSpeechHistory(now)}:{}),...(this.opts.perception?.enabled===true?{localPerceptionEnabled:true,observationAt:Math.max(now??0,(this.opts.publicationNow??Date.now)())}:{}),...(now!==undefined&&this.opts.socialStatus?{conversationHistory:this.conversationHistory(now)}:{}),...(this.opts.residentActions?.fallbackRecovery?{residentFallbackRecovery:true}:{}),...(this.residentSpeechEnabled()?{residentValuesEnabled:true}:{}),canProposeTrade:(s,a,b,g,w,at)=>{
      // This main pending-claim constraint applies even with Life mode disabled.
      // A trusted current-claim hook must explicitly authorize personal participation.
      // Prefix alone neither grants authority nor permanently rejects a verified claim.
      const allowed=h.canProposeTrade?.(s,a,b,g,w,at);
      if((a.startsWith('pm_')||b.startsWith('pm_'))&&allowed!==true)return false;
      if(allowed===false)return false;
      if(p?.enabled!==true)return true;
      const registry=(this.opts as RuntimeOptions & {residentLife?:{enabled:boolean;ownershipKind:(id:string)=>string}}).residentLife;
      const active=registry?.enabled===true&&registry.ownershipKind(a)==='resident';
      return !active||(p.authorize(s,a,null,at)&&(!this.opts.delegationValid||this.opts.delegationValid(a))&&p.goals.refusalUntil(s.worldId,a,b,g,w)<=at);
    }};
  }

  canResidentProposeTrade(s:WorldState,actor:string,peer:string,give:string,want:string,at:number):boolean{return this.engineHooks().canProposeTrade?.(s,actor,peer,give,want,at)??true;}

  private notifyCommit(before:WorldState,after:WorldState,events:readonly WorldEvent[],now:number){
    const p=this.opts.residentGoals;
    if(p?.enabled){if(!this.ownsResidentGoalStore(p.goals))throw Error('resident goal storage mismatch');recordResidentTradeRefusalsInTransaction(p.goals,before,after,events,now,id=>{const registry=(this.opts as RuntimeOptions & {residentLife?:{enabled:boolean;ownershipKind:(id:string)=>string}}).residentLife;return registry?.enabled===true&&registry.ownershipKind(id)==='resident'&&p.authorize(after,id,null,now)&&(!this.opts.delegationValid||this.opts.delegationValid(id));});completeResidentGoalsInTransaction({...p,ownership:id=>{const r=(this.opts as RuntimeOptions & {residentLife?:{enabled:boolean;ownershipKind:(id:string)=>'resident'|'personal'|'legacy'|'unknown'}}).residentLife;return r?.enabled?r.ownershipKind(id):'unknown';},authorize:(s,a,b,at)=>p.authorize(s,a,b,at)&&(!this.opts.delegationValid||this.opts.delegationValid(a))},before,after,events,now);}
    if(this.opts.residentReflection?.enabled===true&&this.lifeStore){const row=this.lifeStore.load(this.worldId);if(row){const next=rememberPublicRelations(row.state,after,events,now,id=>knownResident(id,this.actionOwnership,true));if(saveLife(next)!==saveLife(row.state))this.lifeStore.saveInTransaction(this.worldId,row.revision,next);}}
    synchronous(this.opts.onCommit?.(structuredClone(before),structuredClone(after),structuredClone(events),now));
  }

  static createResidentServices=createResidentServices;

  ownsResidentGoalStore(store:{sharesStorage:(sql:TxSql)=>boolean}):boolean{return store.sharesStorage(this.sql);}

  constructor(sql: TxSql, opts: RuntimeOptions) { this.sql = sql; this.opts = {...opts, hooks: withMessageHooks(opts.hooks)}; this.runLog = new RunLog(sql, opts.worldId); }
  get worldId() { return this.opts.worldId; }

  init(now: number) {
    this.sql.exec('CREATE TABLE IF NOT EXISTS world (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL, version INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS ticks (day TEXT NOT NULL, tick INTEGER NOT NULL, committed_at INTEGER NOT NULL, spotlight TEXT, PRIMARY KEY (day, tick))');
    // Append-only run log (8.6): rows are never deleted. The only UPDATE is the key purge (data-retention.ts), which
    // anonymizes a row in place and keeps its id, tick, time, source and kind.
    this.sql.exec('CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, muse TEXT, other TEXT, place TEXT, line TEXT, data TEXT, tags TEXT NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS events_tags ON events (tags) WHERE tags != \'[]\'');
    // Lookups by kind and time (spotlight request limits, recent events of one kind); IF NOT EXISTS migrates old worlds.
    this.sql.exec('CREATE INDEX IF NOT EXISTS events_kind_at ON events (kind, at)');
    this.sql.exec(COMMANDS_TABLE);
    this.sql.exec('CREATE TABLE IF NOT EXISTS refusals (key TEXT PRIMARY KEY, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, count INTEGER NOT NULL)');
    this.runLog.init();
    if(this.opts.residentLife?.enabled===true){
      this.lifeStore=new ResidentLifeStore(this.sql);this.lifeStore.init();
      if(!this.lifeStore.load(this.worldId)){
        const initial=restoreLife(saveLife(this.opts.residentLife.initialState));
        initial.residents=initial.residents.filter(r=>knownResident(r.id,this.opts.residentActions?.enabled?this.actionOwnership:this.opts.residentLife!.ownershipKind,this.opts.residentActions?.enabled));
        this.lifeStore.save(this.worldId,null,initial);
      }
    }
    const existed = this.sql.exec('SELECT id FROM world WHERE id = 1').toArray().length > 0;
    if (!existed) {
      const s = createWorld(this.opts.worldId, now);
      this.sql.exec('INSERT INTO world (id, state, version) VALUES (1, ?, ?)', JSON.stringify(s), s.version);
    }
    // A new world, the first start of a world stored before the run log, or new code versions: the run record says which.
    this.runLog.open(this.state(), now, existed);
    const policy=this.opts.residentLife;
    if(policy?.enabled===true&&policy.roster){
      const row=this.lifeStore!.load(this.worldId)!;
      if(enrollResidentRoster(this.state(),row.state,now,{...policy,roster:policy.roster}).changed){
        this.commit(now,'resident-roster-v1',(world,emit)=>{
          if(policy.enabled!==true||!policy.roster)throw Error('resident roster disabled before commit');
          const fresh=this.lifeStore!.load(this.worldId)!;
          const enrolled=enrollResidentRoster(world,fresh.state,now,{...policy,roster:policy.roster});
          world.muses=enrolled.world.muses;
          this.lifeStore!.saveInTransaction(this.worldId,fresh.revision,enrolled.life);
          for(const id of enrolled.joined)emit({at:now,source:'rule',kind:'resident_join',muse:id,place:world.muses.find(m=>m.id===id)!.place,data:{roster:policy.roster},tags:[]});
        },changed=>changed,'external',()=>({action:'resident_roster',roster:policy.roster}));
      }
    }
    if(this.opts.judgeMuseEnabled?.()===true){
      const world=this.state(),existing=world.muses.find(m=>m.id===JUDGE_MUSE.id);
      if(existing&&(existing.residentRole!==JUDGE_MUSE.roleId||existing.profile||existing.controlMode==='personal'))throw Error('judge_muse_identity_collision');
      const life=this.lifeStore?.load(this.worldId);
      if(!existing||life&&!life.state.residents.some(r=>r.id===JUDGE_MUSE.id))this.commit(now,'judge-muse-v1',(s,emit)=>{
        if(this.opts.judgeMuseEnabled?.()!==true)throw Error('judge_muse_unavailable');
        const h=harnessById(JUDGE_MUSE.id);
        if(!s.muses.some(m=>m.id===JUDGE_MUSE.id)){
          if(s.muses.length>=64)throw Error('resident world capacity');
          s.muses.push({id:JUDGE_MUSE.id,residentRole:JUDGE_MUSE.roleId,place:'commons:campfire',travel:null,beat:null,inventory:[h.roleItem!],memory:[],reflection:'',lastMet:{},intent:null,wants:{goal:h.wants.goal,items:[...h.wants.items],source:'harness',updatedAt:now}});
          emit({at:now,source:'rule',kind:'resident_join',muse:JUDGE_MUSE.id,place:'commons:campfire',data:{roster:'shared-judge-v1'},tags:[]});
        }
        if(this.lifeStore){const row=this.lifeStore.load(this.worldId)!;if(!row.state.residents.some(r=>r.id===JUDGE_MUSE.id)){row.state.residents.push({id:JUDGE_MUSE.id,roleId:JUDGE_MUSE.roleId,goal:h.wants.goal,routine:[{hour:0,place:'commons:campfire'}],memories:[],promises:[],lastServedAt:0,served:0});this.lifeStore.saveInTransaction(this.worldId,row.revision,row.state);}}
      },changed=>changed,'external',()=>({action:'judge_muse_enrollment'}));
    }
    this.reconcileResidentFreeze(now);
  }

  private reconcileResidentFreeze(now:number):void {
    const before=this.state(),next=structuredClone(before);setResidentFrozen(next,this.frozenResidents(next),now);
    if(JSON.stringify(next)!==JSON.stringify(before))this.commit(now,'resident-roster-policy',()=>{},changed=>changed,'external',()=>({action:'resident_roster_policy',frozen:this.frozenResidents(next)}));
  }

  /** Shared public AOI over a trusted caller's single snapshot. Reads never create events or model calls. */
  perceptionFor(actorId:string,now:number,snapshot:WorldState=this.state()){
    if(snapshot.worldId!==this.worldId)return null;
    return perceptionView(snapshot,actorId,now,this.opts.perception,this.opts.socialStatus);
  }
  perceptionNotices(actorId:string,sinceSeq=0,limit=20){
    if(this.opts.perception?.enabled!==true||!this.state().muses.some(m=>m.id===actorId))return [];
    return perceptionHistory(this.sql,this.worldId,actorId,sinceSeq,limit);
  }
  private raw() { return String(this.sql.exec('SELECT state FROM world WHERE id = 1').toArray()[0].state); }
  state(): WorldState { return JSON.parse(this.raw()); }
  /** Inserts a commit's events with their run and input row (C08); a repeated id is ignored (the log keeps the first). */
  private insertEvents(events: WorldEvent[], ref: {runId: string; seq: number} | null) {
    let inserted = 0;
    for (const e of events) {
      this.sql.exec('INSERT OR IGNORE INTO events (id, tick, at, source, kind, muse, other, place, line, data, tags, run_id, input_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', e.id, e.tick, e.at, e.source, e.kind, e.muse, e.other ?? null, e.place ?? null, e.line ?? null, JSON.stringify(e.data ?? {}), JSON.stringify(e.tags), ref?.runId ?? null, ref?.seq ?? null);
      inserted += Number(this.sql.exec('SELECT changes() AS n').toArray()[0]?.n ?? 0);
    }
    return inserted;
  }
  /** The run-log row and the events of one commit, in its transaction; the row counts the event rows really stored. */
  private logCommit(c: CommitRecord) {
    // Business timestamps precede asynchronous model stages. Persist actual availability so client cues do not expire
    // before publication; all observers/replay use the same clock and e.at remains the original event time.
    const publishedAt = Math.max(c.at, (this.opts.publicationNow ?? Date.now)());
    for (const e of c.events) e.data = {...e.data, publishedAt};
    const p = this.runLog.prepare(c);
    if(p)c.events.push(...derivedPerceptionEvents(this.sql,c,p,publishedAt,this.opts.perception,this.opts.socialStatus));
    const inserted = this.insertEvents(c.events, p);
    if (p) this.runLog.append(p, inserted);
  }

  private trustedPersonalPeers(s:WorldState):string[] {
    return s.muses.filter(m=>/^pm_[A-Za-z0-9_-]{1,128}$/.test(m.id)&&m.controlMode==='personal'&&this.opts.residentLife?.ownershipKind(m.id)==='personal').map(m=>m.id);
  }

  private registryControls(muse:string):boolean {
    const kind=this.opts.residentLife?.ownershipKind(muse);
    if(muse===JUDGE_MUSE.id&&this.opts.judgeMuseEnabled?.()!==true)return true;
    return kind==='personal'||kind==='unknown'||(isResidentInstance(muse)&&(this.opts.residentLife?.enabled!==true||this.opts.residentLife.roster!=='neighborhood-24-v1'));
  }

  /** Current server policy for signed preconditions, including the interval before the next alarm. */
  residentUnavailable(id:string):boolean {
    const m=this.state().muses.find(m=>m.id===id);
    return !!m&&(isResidentInstance(id)||id===JUDGE_MUSE.id)&&m.residentRole===harnessRoleId(id)&&m.controlMode!=='personal'&&!m.profile&&this.registryControls(id);
  }

  private frozenResidents(world:WorldState):string[]{
    return world.muses.filter(m=>(isResidentInstance(m.id)||m.id===JUDGE_MUSE.id)&&this.registryControls(m.id)).map(m=>m.id);
  }

  private residentIdleIds(life:LifeState|undefined,world:WorldState,now:number):string[]{
    const policy=this.opts.residentLife;
    if(!life||policy?.enabled!==true)return [];
    return life.residents.filter(r=>(r.routine.some(x=>policy.allowedPlaceIds.includes(x.place))||r.promises.some(p=>p.status==='pending'&&policy.allowedPlaceIds.includes(p.place)))&&knownResident(r.id,policy.ownershipKind)&&world.muses.some(m=>m.id===r.id)&&!world.paused?.[r.id]&&!isRuntimeControlled(world,r.id,now)&&(!this.opts.delegationValid||this.opts.delegationValid(r.id))).map(r=>r.id);
  }

  /** One heartbeat. Safe to call again after a crash or an alarm retry. */
  async heartbeat(now: number): Promise<HeartbeatResult> {
    let before = this.state();
    if (now - before.lastTickAt < TICK_MS * 0.9 && before.tick > 0) return {status: 'skipped_early', tick: before.tick, events: 0};
    // A second run for the same tick (alarm retry while the first is still waiting) stops here,
    // before any model call: the tick is committed or its spotlight reservation already exists.
    if (this.tickTaken(before)) return {status: 'skipped_duplicate', tick: before.tick, events: 0};
    const originalTickReservation=this.reservationId(before);
    try {
      if(this.opts.residentActions?.enabled){const result=await this.activityHeartbeat(before,now);if(result.status==='committed')await this.reflectResident(now);return result;}
      // Own this turn before any resident negotiation awaits; later visitors remain queued for the next tick.
      const spot = spotlightFor(before, now), turn = {muse: spot.muse, priority: spot.priority};
      const goals=this.opts.residentGoals;
      const goalResult=goals?.enabled?runResidentGoalTurn(this,{...goals,authorize:(s,a,b,at)=>goals.enabled===true&&goals.authorize(s,a,b,at)&&(!this.opts.delegationValid||(this.opts.delegationValid(a)&&(!b||this.opts.delegationValid(b)))),ownership:id=>{const registry=(this.opts as RuntimeOptions & {residentLife?:{enabled:boolean;ownershipKind:(id:string)=>'resident'|'personal'|'legacy'|'unknown'}}).residentLife;return registry?.enabled===true?registry.ownershipKind(id):'unknown';}},now,this.opts.hooks):null;
      const wants=this.opts.residentWants;
      // Never allow a plugin to substitute a second budget/model/registry or ignore revocation.
      const clock=()=>Math.max(now,wants?.context.now()??now);
      const negotiated=wants?.enabled===true ? await runResidentWantsTurn(this,{...wants,authorize:(s,a,b,at)=>wants.enabled===true&&wants.context.enabled===true&&wants.authorize(s,a,b,at)&&(!this.opts.delegationValid||(this.opts.delegationValid(a)&&this.opts.delegationValid(b))),context:{...wants.context,residentValuesEnabled:this.opts.residentValuesEnabled===true,now:clock,ledger:this.opts.ledger,model:this.opts.model?.key?{...this.opts.model,key:this.opts.model.key}:null,ownership:id=>{const registry=(this.opts as RuntimeOptions & {residentLife?:{enabled:boolean;ownershipKind:(id:string)=>'resident'|'personal'|'legacy'|'unknown'}}).residentLife;return registry?.enabled===true?registry.ownershipKind(id):'unknown';}}},now) : null;
      const refreshed=this.state();
      if(refreshed.tick!==before.tick||refreshed.day!==before.day)return {status:'skipped_duplicate',tick:refreshed.tick,events:0};
      before=refreshed;now=Math.max(clock(),before.lastTickAt);
      const wantsEnglishRejected=negotiated?.ok===false&&negotiated.reason==='output_rejected:'+PUBLIC_SPEECH_NOT_ENGLISH;
      const wantsConsumedTurn=wantsEnglishRejected||goalResult?.ok===true||goalResult?.reason==='turn_already_consumed'||negotiated?.ok===true||['turn_already_consumed','already_reserved','timeout','network','upstream','bad_output','rate_limited','output_rejected','invalid_trade_choice','recent_explicit_refusal','goal_utility_not_improved','stale_authority_or_state','stale_task','trade_precondition_changed'].includes(negotiated?.reason??'');
      const [{decision, info}, canMeet] = await Promise.all([wantsConsumedTurn?Promise.resolve({decision:null,info:{source:'rule',reason:wantsEnglishRejected?'output_rejected:'+PUBLIC_SPEECH_NOT_ENGLISH:negotiated?.ok===true||negotiated?.reason==='turn_already_consumed'?'resident_trade_turn':'resident_trade_attempt'}}):this.liveSpotlight(before, spot.muse, spot.freedom, now), this.meetingGate(before, now)]);
      // The spotlight slot is free again: this tick's meetings, and the other Muse's answer to each.
      const lifeBefore=this.lifeStore?.load(this.worldId) ?? null;
      const residentIdle=this.residentIdleIds(lifeBefore?.state,before,now);
      const proposedLife=!decision && (!this.opts.delegationValid||this.opts.delegationValid(spot.muse)) && lifeBefore && this.opts.residentLife ? residentProposalForWorld(lifeBefore.state,before,now,{...this.opts.residentLife,promiseGraceMs:this.opts.residentLife.promiseGraceMs ?? 60*TICK_MS,residentTurnAllowed:true}) : null;
      const residentMove=proposedLife ? {muse:proposedLife.residentId,place:proposedLife.placeId,expectedVersion:proposedLife.expectedWorldVersion} : undefined;
      const englishFallback = info.reason === 'output_rejected:' + PUBLIC_SPEECH_NOT_ENGLISH ? spot.muse : undefined;
      const answers = await this.encounterReplies(before, now, decision, canMeet, turn, residentMove,residentIdle,englishFallback);
      this.opts.beforeCommit?.();
      // Commit point: everything below is synchronous and one storage transaction.
      const result=this.sql.transactionSync<HeartbeatResult>(() => {
      const raw = this.raw(), current: WorldState = JSON.parse(raw);
      if (current.tick !== before.tick || current.day !== before.day || this.sql.exec('SELECT 1 FROM ticks WHERE day = ? AND tick = ?', before.day, before.tick).toArray().length) return {status: 'skipped_duplicate', tick: before.tick, events: 0};
      const freshLife=this.lifeStore?.load(this.worldId) ?? null;
      const staleResidentContext=(evidence:Record<string,unknown>|undefined,muse:string):boolean => evidence?.residentLifeRevision!==undefined &&
        (evidence.residentLifeRevision!==freshLife?.revision || this.opts.residentLife?.enabled!==true || !knownResident(muse,this.opts.residentLife.ownershipKind));
      let usable = decision;
      const late: Omit<WorldEvent, 'id' | 'tick'>[] = [];
      // The answer keeps its turn unless its Muse was paused or revoked, or the world itself moved (a queue request does
      // not move it). One discard event, with the most specific reason.
      const lost = !decision ? null : current.paused?.[decision.muse] ? 'paused before commit' : this.registryControls(decision.muse) ? 'registry controlled before commit' : isRuntimeControlled(current,decision.muse,now) ? 'personal or connected before commit' : this.opts.delegationValid && !this.opts.delegationValid(decision.muse) ? 'delegation revoked before commit' : staleResidentContext(decision.evidence,decision.muse) ? 'resident context changed while the model was answering' : current.version !== before.version ? 'world changed while the model was answering' : null;
      if (decision && lost) { late.push({at: now, source: decision.source, kind: 'decision_discarded', muse: decision.muse, data: {reason: lost, evidence: decision.evidence ?? null}, tags: []}); usable = null; }
      // Same checks for every model answer to a meeting: a revoked answerer or a moved world discards it (it was paid for).
      const discard = (r: EncounterReply, reason: string) => late.push({at: now, source: r.source as WorldEvent['source'], kind: 'encounter_reply_discarded', muse: r.muse, other: r.other, place: r.place, data: {reason, encounterId: r.encounterId, evidence: r.evidence ?? null}, tags: []});
      const replies = answers.map(r => {
        if (r.source === 'rule') return r;
        const why = current.paused?.[r.muse] ? 'paused before commit' : this.registryControls(r.muse) ? 'registry controlled before commit' : isRuntimeControlled(current,r.muse,now) ? 'personal or connected before commit' : this.opts.delegationValid && !this.opts.delegationValid(r.muse) ? 'delegation revoked before commit' : staleResidentContext(r.evidence,r.muse) ? 'resident context changed while the model was answering' : current.version !== before.version ? 'world changed while the model was answering' : null;
        if (!why) return r;
        discard(r, why);
        return {muse: r.muse, other: r.other, place: r.place, encounterId: r.encounterId, source: 'rule' as const, output: null, reason: 'discarded: ' + why};
      });
      const committedGoalIdle=this.goalIdle(current,now);
      const lifeCandidate=!decision && (!this.opts.delegationValid||this.opts.delegationValid(turn.muse)) && proposedLife && lifeBefore && freshLife?.revision===lifeBefore.revision && current.version===before.version && this.opts.residentLife ? residentProposalForWorld(freshLife.state,current,now,{...this.opts.residentLife,promiseGraceMs:this.opts.residentLife.promiseGraceMs ?? 60*TICK_MS,residentTurnAllowed:true}) : null;
      const acceptedLife=lifeCandidate && !committedGoalIdle.includes(lifeCandidate.residentId) && !this.registryControls(lifeCandidate.residentId) && lifeCandidate.residentId===proposedLife?.residentId && lifeCandidate.placeId===proposedLife?.placeId ? lifeCandidate : null;
      const appliedMove=acceptedLife ? {muse:acceptedLife.residentId,place:acceptedLife.placeId,expectedVersion:acceptedLife.expectedWorldVersion} : undefined;
      const committedIdle=this.residentIdleIds(freshLife?.state,current,now);
      const {state, events} = tick(current, {now, decision: usable, replies, spot: turn, residentMove:appliedMove,residentIdle:committedIdle,residentFrozen:this.frozenResidents(current),residentGoalIdle:committedGoalIdle,...(englishFallback?{residentEnglishFallback:englishFallback}:{})}, canMeet ? {...this.engineHooks(now), canMeet: this.dedupMeetings(canMeet)} : this.engineHooks(now));
      if(this.lifeStore && freshLife && this.opts.residentLife?.enabled===true){
        let lifeNext=rememberCommittedResidentEvents(freshLife.state,state,events,now,id=>knownResident(id,this.opts.residentLife!.ownershipKind),current);
        if(acceptedLife)lifeNext=noteServed(lifeNext,acceptedLife.residentId,now);
        this.lifeStore.saveInTransaction(this.worldId,freshLife.revision,lifeNext);
      }
      // Task records (C06, I-07): revision and contentHash follow any content change the tick made.
      syncTasks(state.inbox);
      // A model answer to a meeting that did not happen in the committed tick is not used.
      const answered = new Set(events.filter(e => e.kind === 'encounter_reply').map(e => `${e.data?.encounterId}>${e.muse}`));
      for (const r of replies) if (r.source !== 'rule' && !answered.has(`${r.encounterId}>${r.muse}`)) discard(r, 'the meeting did not happen at commit');
      // Refusal windows that closed (here or during the tick) leave one summary with their repeat count.
      const repeats = [...this.closedRepeats.splice(0), ...this.closeRefusalWindows(now)].map((e, i) => ({...e, id: `${current.day}:${current.tick}:repeats${i}`, tick: current.tick}));
      const all = [...events, ...late.map((e, i) => ({...e, id: `${current.day}:${current.tick}:late${i}`, tick: current.tick})), ...repeats];
      if (!usable && info.reason) all.push({at: now, source: info.source as WorldEvent['source'], kind: 'spotlight_fallback', muse: spot.muse, data: {reason: info.reason}, tags: [], id: `${current.day}:${current.tick}:fallback`, tick: current.tick});
      this.sql.exec('UPDATE world SET state = ?, version = ? WHERE id = 1', JSON.stringify(state), state.version);
      this.sql.exec('INSERT INTO ticks (day, tick, committed_at, spotlight) VALUES (?, ?, ?, ?)', current.day, current.tick, now, JSON.stringify({muse: turn.muse, priority: turn.priority, ...info}));
      // The tick's recorded inputs (8.1: not reproducible from the seed): the spotlight answer, used or discarded, and
      // every meeting answer with its source; ids of the model calls, never the prompt.
      const tickInput = {
        ...(englishFallback?{residentEnglishFallback:englishFallback}:{}),
        residentRosterFrozen:this.frozenResidents(current),
        ...(this.opts.residentLife?.enabled===true ? {residentLifePolicy:{version:1,idle:committedIdle}} : {}),
        ...(acceptedLife ? {residentLife:{policyVersion:1,source:'rule',proposal:acceptedLife,revisionBefore:freshLife!.revision,revisionAfter:freshLife!.revision+1}} : {}),
        residentGoalIdle:committedGoalIdle,seed: state.seed, gate: canMeet ? 'checked' : 'off',
        spotlight: {muse: turn.muse, ...(typeof decision?.evidence?.residentLifeRevision==='number'?{residentLifeRevision:decision.evidence.residentLifeRevision}:{}), priority: turn.priority, source: info.source, reason: reasonCode(info.reason), freedom: spot.freedom, used: !!usable, discarded: decision && lost ? reasonCode(lost) : null,
          decision: decision ? {source: decision.source, freedom: decision.freedom, output: outputFields(decision.output), evidence: evidenceIds(decision.evidence)} : null},
        replies: answers.map(r => ({muse: r.muse, ...(typeof r.evidence?.residentLifeRevision==='number'?{residentLifeRevision:r.evidence.residentLifeRevision}:{}), other: r.other, encounterId: r.encounterId, source: r.source, reason: reasonCode(r.reason), output: outputFields(r.output), evidence: evidenceIds(r.evidence), used: r.source === 'rule' || (replies.find(x => x.encounterId === r.encounterId && x.muse === r.muse)?.source !== 'rule' && answered.has(`${r.encounterId}>${r.muse}`))})),
      };
      this.logCommit({at: now, kind: 'tick', label: `${current.day}:${current.tick}`, beforeRaw: raw, before: current, after: state, changed: true, events: all, input: tickInput});
      this.notifyCommit(current,state,all,now);
      const said = all.filter(e => e.kind === 'encounter_reply');
      return {status: 'committed' as const, tick: current.tick, events: all.length, spotlight: {muse: turn.muse, ...(typeof decision?.evidence?.residentLifeRevision==='number'?{residentLifeRevision:decision.evidence.residentLifeRevision}:{}), priority: turn.priority, ...info}, replies: {live: said.filter(e => e.source === 'live').length, rule: said.filter(e => e.source === 'rule').length}};
      });
      if(result.status==='committed')await this.reflectResident(now);
      return result;
    } finally {
      this.inFlight.delete(originalTickReservation);
    }
  }

  private actionOwnership=(id:string):ResidentOwnershipKind=>{
    const kind=this.opts.residentLife?.ownershipKind(id)??'unknown';
    return this.opts.residentActions?.enabled&&['04-ember','09-copper'].includes(id)&&kind==='legacy'?'resident':kind;
  };
  /** Model priority is not native-action display priority. No owner/connected actor is thought for here. */
  private modelPriorityBlock(s:WorldState,id:string,now:number):'self_directed'|'model_unavailable'|null {
    const m=s.muses.find(m=>m.id===id);if(!m)return 'model_unavailable';
    if(id==='00-jolly'||id.startsWith('pm_')||m.profile||m.controlMode==='personal'||this.actionOwnership(id)==='personal')return 'self_directed';
    if(['04-ember','09-copper'].includes(id)){
      const control=this.opts.operatingResidentControl?.(id,now)??'unknown';
      if(control==='connected')return 'self_directed';
      if(control!=='resident')return 'model_unavailable';
    }else if(isRuntimeControlled(s,id,now))return 'self_directed';
    return knownResident(id,this.actionOwnership,true)?null:'model_unavailable';
  }
  private statusOf=(s:WorldState,id:string,now:number):SocialStatus=>this.opts.socialStatus?.(s,id,now)??(s.muses.find(m=>m.id===id)?.travel?'busy':'welcoming');
  private choiceAvailable(s:WorldState,d:Decision,now:number):boolean{
    if(!this.opts.socialStatus||!['who','offer'].includes(d.freedom))return true;
    const target=d.output.target_agent.trim().toLowerCase(),peer=s.muses.find(m=>m.id.toLowerCase()===target||participantName(s,m.id).toLowerCase()===target);
    return !!peer&&this.statusOf(s,peer.id,now)==='welcoming';
  }
  private activityLife(life:LifeState,world:WorldState):LifeState{
    const next=restoreLife(saveLife(life));
    for(const id of ['04-ember','09-copper']){
      const m=world.muses.find(m=>m.id===id);
      if(!m||m.profile||m.controlMode==='personal'||this.actionOwnership(id)!=='resident'||next.residents.some(r=>r.id===id))continue;
      next.residents.push({id,roleId:id,goal:m.wants.goal.slice(0,160),routine:[],memories:[],promises:[],lastServedAt:0,served:0});
    }
    return restoreLife(saveLife(next));
  }
  /** Life03 changes scheduling, not the engine/authority/ledger or commit transaction. */
  private async activityHeartbeat(initial:WorldState,now:number):Promise<HeartbeatResult>{
    if(!this.lifeStore||!this.opts.residentLife?.enabled)throw Error('resident_life_required');
    let before=initial;
    // Older releases enqueued a connected actor after its own action. Those entries
    // describe already-recorded native activity, not an authorization for a team-model decision.
    const cancelledPriority=(s:WorldState,id:string)=>!s.muses.some(m=>m.id===id)?'unknown_muse':this.modelPriorityBlock(s,id,now)==='self_directed'?'self_directed':null;
    if(before.spotlight.visitorQueue.some(id=>cancelledPriority(before,id))){
      this.commit(now,'spotlight-native-queue-reconcile',(s,emit)=>{
        s.spotlight.visitorQueue=s.spotlight.visitorQueue.filter(id=>{
          const reason=cancelledPriority(s,id);if(!reason)return true;
          emit({at:now,source:'rule',kind:'spotlight_cancelled',muse:id,data:{reason,queued:false},tags:[]});return false;
        });
      },()=>false,'external',()=>({action:'spotlight_native_queue_reconcile'}));
      before=this.state();
    }
    const control=this.opts.operatingResidentControl;
    if(control){
      const proposed=handoffOperatingResidents(before,now,this.actionOwnership,control);
      if(proposed.changed)this.commitExternal(now,'resident-control-handoff',(s,emit)=>{
        const fresh=handoffOperatingResidents(s,now,this.actionOwnership,control);
        if(fresh.changed){s.inbox=fresh.world.inbox;for(const e of fresh.events)emit(e);}
      });
      before=this.state();
    }
    // Preserve the installed goal/Task services and their own transactional authority guards.
    // Their selected turn is not a second freely chosen activity for the same actor.
    const serviceSpot=spotlightFor(before,now),goals=this.opts.residentGoals,wants=this.opts.residentWants;
    const goalResult=goals?.enabled?runResidentGoalTurn(this,{...goals,authorize:(s,a,b,at)=>goals.enabled===true&&goals.authorize(s,a,b,at)&&(!this.opts.delegationValid||(this.opts.delegationValid(a)&&(!b||this.opts.delegationValid(b)))),ownership:id=>this.opts.residentLife?.enabled===true?this.opts.residentLife.ownershipKind(id):'unknown'},now,this.opts.hooks):null;
    const clock=()=>Math.max(now,wants?.context.now()??now);
    const negotiated=wants?.enabled===true?await runResidentWantsTurn(this,{...wants,authorize:(s,a,b,at)=>wants.enabled===true&&wants.authorize(s,a,b,at)&&(!this.opts.delegationValid||(this.opts.delegationValid(a)&&this.opts.delegationValid(b))),context:{...wants.context,residentValuesEnabled:this.opts.residentValuesEnabled===true,now:clock,ledger:this.opts.ledger,model:this.opts.model?.key?{...this.opts.model,key:this.opts.model.key}:null,ownership:id=>this.opts.residentLife?.enabled===true?this.opts.residentLife.ownershipKind(id):'unknown'}},now):null;
    const refreshed=this.state();if(refreshed.tick!==before.tick||refreshed.day!==before.day)return{status:'skipped_duplicate',tick:refreshed.tick,events:0};
    before=refreshed;now=Math.max(clock(),before.lastTickAt);
    const serviceEnglishFallback=negotiated?.ok===false&&negotiated.reason==='output_rejected:'+PUBLIC_SPEECH_NOT_ENGLISH?serviceSpot.muse:undefined;
    const serviceConsumed=!!serviceEnglishFallback||goalResult?.ok===true||goalResult?.reason==='turn_already_consumed'||negotiated?.ok===true||['turn_already_consumed','already_reserved','timeout','network','upstream','bad_output','rate_limited','output_rejected','invalid_trade_choice','recent_explicit_refusal','goal_utility_not_improved','stale_authority_or_state','stale_task','trade_precondition_changed'].includes(negotiated?.reason??'');
    const stored=this.lifeStore.load(this.worldId)!;
    const life=this.activityLife(stored.state,before);
    const allowed=(s:WorldState,id:string)=>residentEligible(s,id,now,this.actionOwnership,control)&&(!this.opts.delegationValid||this.opts.delegationValid(id));
    const actors=before.muses.filter(m=>knownResident(m.id,this.actionOwnership,true)&&!m.profile&&m.controlMode!=='personal').map(m=>m.id);
    // A missing-material goal is a continuing need, not an occupied activity. Actual
    // beats/trips/Tasks remain protected by dueResidents; preserve a completing craft's
    // original inventory/receipt tick before choosing its next activity on the next tick.
    const finishingGoals=goals?.enabled===true?before.muses.filter(m=>{
      const beat=m.beat;return beat&&beat.endsAt<=now&&goals.goals.activeFor(before.worldId,m.id).some(r=>r.goal.beat===beat.id&&r.goal.expiresAt>now);
    }).map(m=>m.id):[];
    const due=dueResidents(before,now,this.actionOwnership,control).filter(id=>allowed(before,id)&&!finishingGoals.includes(id)&&!(serviceConsumed&&id===serviceSpot.muse))
      .sort((a,b)=>(life.residents.find(r=>r.id===a)?.lastServedAt??0)-(life.residents.find(r=>r.id===b)?.lastServedAt??0)||a.localeCompare(b));
    const context=(s:WorldState,id:string)=>residentContextForWorld({revision:stored.revision,state:life},s,id,now,{...this.opts.residentLife!,ownershipKind:this.actionOwnership,includeOperatingResidents:true,includeRelationships:this.opts.residentReflection?.enabled===true});
    const planning=tick(before,{now,spot:{muse:serviceSpot.muse,priority:serviceSpot.priority},residentActors:actors,requirePriorityApplication:true,residentFrozen:this.frozenResidents(before)},{...this.engineHooks(now),canMeet:()=>({ok:false,event:null})}).state;
    let priorityInfo:{source:string;reason?:string}={source:'rule',reason:'activity_or_authority_pending'};
    let priorityAttempted=false;
    const outcomes=await Promise.all([...due].sort((a,b)=>Number(b===serviceSpot.muse&&serviceSpot.priority)-Number(a===serviceSpot.muse&&serviceSpot.priority)).map(async id=>{
      try{
        const projected=decisionWorld(planning,id,now),base=validate('spotlight',spotlightInput(projected,id,'plan',now),this.trustedPersonalPeers(projected));
        const input={...base,activities:residentActivityCatalog(projected,id,now)};
        if(serviceSpot.priority&&id===serviceSpot.muse){
          priorityAttempted=true;
          const chosen=await this.liveSpotlight(projected,id,serviceSpot.freedom,now,true);priorityInfo=chosen.info;
          if(!chosen.decision)return{id,reason:chosen.info.reason??'priority_unavailable',turn:null};
          const output=chosen.decision.output as ResidentActivityOutput;
          return{id,reason:null,turn:{decision:chosen.decision,stayMinutes:output.duration_minutes}};
        }
        const out=await this.modelCall('spotlight',input,`${this.worldId}:${before.day}:${before.tick}:activity:${id}`,context(projected,id),true,{world:projected,at:now});
        if(!out.ok)return{id,reason:out.reason,turn:null};
        const output=out.output as ResidentActivityOutput;
        return{id,reason:null,turn:{decision:{muse:id,freedom:output.freedom,source:'live' as const,output,evidence:out.evidence},stayMinutes:output.duration_minutes}};
      }catch{return{id,reason:'input_invalid',turn:null};}
    }));
    const plans=outcomes.flatMap(r=>r.turn?[r.turn]:[]),fallback=outcomes.filter(r=>!r.turn).map(r=>r.id);
    const canMeet=await this.meetingGate(before,now);
    const preview=tick(before,{now,spot:{muse:serviceSpot.muse,priority:serviceSpot.priority},residentEnglishFallback:serviceEnglishFallback,residentActors:actors,residentTurns:plans,residentFallback:fallback,requirePriorityApplication:true,residentFrozen:this.frozenResidents(before)},canMeet?{...this.engineHooks(now),canMeet}:this.engineHooks(now));
    const recent=this.events(0,500,{tail:500}).filter(e=>e.at>=before.lastTickAt&&e.at<=now);
    const reacting={...preview.state,version:before.version,tick:before.tick,lastTickAt:before.lastTickAt};
    const prepared=reactionCandidates(reacting,[...recent,...preview.events],life.dialogues??[],now,this.actionOwnership,this.statusOf,control,this.opts.socialStatus!==undefined,this.opts.socialStatus?this.conversationHistory(now):undefined);
    const reactions=await Promise.all(prepared.candidates.map(async candidate=>{
      const base={muse:candidate.muse,other:candidate.other,place:candidate.place,encounterId:candidate.encounterId};
      const rule=(reason:string):ResidentReaction=>({triggerId:candidate.triggerId,kind:candidate.kind,reply:{...base,source:'rule',output:null,reason}});
      if(candidate.kind==='wave')return rule('passing_wave');
      const m=reacting.muses.find(m=>m.id===candidate.muse)!,peer=reacting.muses.find(m=>m.id===candidate.other)!;
      if(this.opts.perception?.enabled===true&&!withinConversationRange(m,peer,now))return{...rule('outside_conversation_range'),kind:'wave' as const};
      if(canMeet&&!canMeet(reacting,m,peer,placeById(m.place),now).ok)return rule('meeting_not_verified');
      try{
        const input=validate('encounter',encounterInput(reacting,m.id,peer.id,m.place,candidate.incoming,now),this.trustedPersonalPeers(reacting));
        const out=await this.modelCall('encounter',input,`${this.worldId}:${before.day}:${before.tick}:reaction:${m.id}:${candidate.triggerId}`,context(reacting,m.id),false,{world:reacting,at:now});
        return out.ok?{triggerId:candidate.triggerId,kind:'reply' as const,reply:{...base,source:'live' as const,output:out.output as EncounterReply['output'],evidence:out.evidence}}:rule(out.reason);
      }catch{return rule('input_invalid');}
    }));
    this.opts.beforeCommit?.();
    return this.sql.transactionSync(()=>{
      const raw=this.raw(),current:WorldState=JSON.parse(raw),fresh=this.lifeStore!.load(this.worldId)!;
      if(current.tick!==before.tick||current.day!==before.day||this.sql.exec('SELECT 1 FROM ticks WHERE day=? AND tick=?',before.day,before.tick).toArray().length)return{status:'skipped_duplicate',tick:current.tick,events:0};
      const stale=current.version!==before.version||fresh.revision!==stored.revision||this.opts.residentActions?.enabled!==true;
      const late:Omit<WorldEvent,'id'|'tick'>[]=[];
      const readyAtCommit=new Set(dueResidents(current,now,this.actionOwnership,control));
      const usable=plans.filter(p=>{
        if(!stale&&readyAtCommit.has(p.decision.muse)&&allowed(current,p.decision.muse)&&this.choiceAvailable(current,p.decision,now))return true;
        late.push({at:now,source:p.decision.source,kind:'decision_discarded',muse:p.decision.muse,data:{reason:stale?'world_or_life_changed':'resident_authority_changed',evidence:p.decision.evidence??null},tags:[]});return false;
      });
      const usableReactions=reactions.filter(r=>{
        if(!stale&&allowed(current,r.reply.muse)&&this.statusOf(current,r.reply.muse,now)!=='do_not_disturb'&&this.statusOf(current,r.reply.other,now)!=='do_not_disturb')return true;
        if(r.reply.source==='live')late.push({at:now,source:'live',kind:'encounter_reply_discarded',muse:r.reply.muse,other:r.reply.other,data:{reason:stale?'world_or_life_changed':'resident_authority_changed',triggerId:r.triggerId,evidence:r.reply.evidence??null},tags:[]});return false;
      });
      const currentActors=current.muses.filter(m=>knownResident(m.id,this.actionOwnership,true)&&!m.profile&&m.controlMode!=='personal').map(m=>m.id);
      const failures=[...fallback,...plans.filter(p=>!usable.includes(p)).map(p=>p.decision.muse)].filter(id=>readyAtCommit.has(id)&&allowed(current,id));
      const englishFallback=!stale&&serviceEnglishFallback&&allowed(current,serviceEnglishFallback)?serviceEnglishFallback:undefined;
      const {state,events}=tick(current,{now,spot:{muse:serviceSpot.muse,priority:serviceSpot.priority},residentEnglishFallback:englishFallback,residentActors:currentActors,residentTurns:usable,residentFallback:failures,residentReactions:usableReactions,requirePriorityApplication:true,residentFrozen:this.frozenResidents(current)},canMeet?{...this.engineHooks(now),canMeet:this.dedupMeetings(canMeet)}:this.engineHooks(now));
      const activityApplied=(p:typeof plans[number])=>usable.includes(p)&&events.some(e=>e.muse===p.decision.muse&&e.source===p.decision.source&&['spotlight','beat','depart','trade_intent'].includes(e.kind));
      const reactionApplied=(r:ResidentReaction)=>usableReactions.includes(r)&&events.some(e=>e.muse===r.reply.muse&&e.data?.triggerId===r.triggerId&&(e.kind==='encounter_reply'||e.kind==='resident_wave'));
      for(const r of usableReactions)if(r.reply.source==='live'&&!reactionApplied(r))late.push({at:now,source:'live',kind:'encounter_reply_discarded',muse:r.reply.muse,other:r.reply.other,data:{reason:'reaction_not_applied',triggerId:r.triggerId,evidence:r.reply.evidence??null},tags:[]});
      let next=rememberCommittedResidentEvents(this.activityLife(fresh.state,current),state,events,now,id=>knownResident(id,this.actionOwnership,true),current);
      let dialogues=settleDialogues(next.dialogues??[],state,now);
      for(const e of [...recent,...events]){
        if(!e.muse||!e.other||!(e.kind==='greet'&&e.data?.public===true||e.kind==='encounter_reply')||!state.muses.some(m=>m.id===e.other)||!state.muses.some(m=>m.id===e.muse))continue;
        if(!knownResident(e.muse,this.actionOwnership,true)&&!knownResident(e.other,this.actionOwnership,true))continue;
        try{dialogues=recordDialogue(dialogues,{id:e.id,from:e.muse,to:e.other,at:e.at});}catch{/* bounded cooldown or duplicate public chatter adds no extra turn */}
      }
      next.dialogues=dialogues;
      for(const id of due)if(next.residents.some(r=>r.id===id))next=noteServed(next,id,now);
      this.lifeStore!.saveInTransaction(this.worldId,fresh.revision,next);
      syncTasks(state.inbox);
      for(const r of outcomes)if(r.reason)late.push({at:now,source:'rule',kind:'resident_activity_fallback',muse:r.id,data:{reason:reasonCode(r.reason)},tags:[]});
      const all=[...events,...late.map((e,i)=>({...e,id:`${current.day}:${current.tick}:life03:${i}`,tick:current.tick}))];
      this.sql.exec('UPDATE world SET state=?,version=? WHERE id=1',JSON.stringify(state),state.version);
      this.sql.exec('INSERT INTO ticks(day,tick,committed_at,spotlight) VALUES(?,?,?,?)',current.day,current.tick,now,JSON.stringify({source:'rule',reason:'completion_driven_residents'}));
      this.logCommit({at:now,kind:'tick',label:`${current.day}:${current.tick}`,beforeRaw:raw,before:current,after:state,changed:true,events:all,input:{seed:state.seed,...(englishFallback?{residentEnglishFallback:englishFallback}:{}),residentActions:{policyVersion:1,actors:currentActors,due,priority:serviceSpot.priority?{muse:serviceSpot.muse,attempted:priorityAttempted,source:priorityInfo.source,reason:reasonCode(priorityInfo.reason),used:outcomes.some(r=>r.id===serviceSpot.muse&&!!r.turn&&activityApplied(r.turn))&&!state.spotlight.visitorQueue.includes(serviceSpot.muse)}:null,turns:outcomes.map(r=>({muse:r.id,reason:reasonCode(r.reason),used:!!r.turn&&activityApplied(r.turn),output:r.turn?outputFields(r.turn.decision.output):null,evidence:r.turn?evidenceIds(r.turn.decision.evidence):null})),reactions:reactions.map(r=>({muse:r.reply.muse,other:r.reply.other,triggerId:r.triggerId,kind:r.kind,source:r.reply.source,used:reactionApplied(r),output:outputFields(r.reply.output),evidence:evidenceIds(r.reply.evidence)}))}}});
      this.notifyCommit(current,state,all,now);
      const said=all.filter(e=>e.kind==='encounter_reply');
      return{status:'committed',tick:current.tick,events:all.length,replies:{live:said.filter(e=>e.source==='live').length,rule:said.filter(e=>e.source==='rule').length}};
    });
  }

  /** One bounded private reflection opportunity per NPC/LA 8-hour slot. It never acts for another Muse. */
  private async reflectResident(now:number):Promise<void>{
    const policy=this.opts.residentReflection,model=this.opts.model;
    if(policy?.enabled!==true||!this.lifeStore||!model?.key||this.opts.residentBudgetEnabled!==true)return;
    const world=this.state(),stored=this.lifeStore.load(this.worldId);if(!stored)return;
    const allowed=(s:WorldState,id:string,at:number)=>knownResident(id,this.actionOwnership,true)&&this.modelPriorityBlock(s,id,at)===null&&!s.paused?.[id]&&!isResidentFrozen(s,id)&&(!this.opts.delegationValid||this.opts.delegationValid(id));
    const plan=nextReflection(stored.state,world,now,id=>allowed(world,id,now));if(!plan)return;
    const persona=policy.persona(plan.actorId);if(typeof persona!=='string'||!persona.trim())return;
    const release=this.modelSlot();if(!release)return;
    const id=`${this.worldId}:${plan.day}:reflection:${plan.actorId}:${plan.slot}`;
    const messages=reflectionMessages(plan,persona);
    try{
      const revision=this.sql.transactionSync(()=>{
        const current=this.state(),fresh=this.lifeStore!.load(this.worldId)!;
        if(current.version!==world.version||fresh.revision!==stored.revision||!allowed(current,plan.actorId,now))return null;
        const reservation=this.opts.ledger.reserve({id,tier:'world',session:'world',ip:'',action:'reflection',residentKind:'reflection',maxCostUsd:maxCostUsd('encounter',messages)});
        if(!reservation.ok||reservation.existing)return null;
        const next=restoreLife(saveLife(fresh.state)),r=next.residents.find(r=>r.id===plan.actorId)!;
        r.reflection={day:plan.day,slots:r.reflection?.day===plan.day?[...r.reflection.slots,plan.slot]:[plan.slot],lastAttemptAt:now,lastReflectedAt:r.reflection?.lastReflectedAt??null,outcome:'pending'};
        return this.lifeStore!.saveInTransaction(this.worldId,fresh.revision,next);
      });
      if(revision===null)return;
      const answer=await callModel({...model,key:model.key,timeoutMs:Math.min(8000,model.timeoutMs)},'encounter',messages,REFLECTION_SCHEMA);
      const invalid=answer.ok?checkReflectionOutput(plan,answer.output):null;
      this.opts.ledger.settle(id,answer.ok?actualCostUsd(answer.usage):failureCostUsd(answer),answer.ok?(invalid?'rejected':'live'):answer.kind==='timeout'?'timeout':'error');
      this.sql.transactionSync(()=>{
        const current=this.state(),fresh=this.lifeStore!.load(this.worldId)!;
        const at=Math.max(now,(this.opts.publicationNow??Date.now)()),clock=reflectionClock(at);
        const valid=this.opts.residentReflection?.enabled===true&&fresh.revision===revision&&current.version===world.version&&current.worldId===world.worldId&&current.day===world.day&&current.tick===world.tick&&clock.day===plan.day&&clock.slot===plan.slot&&allowed(current,plan.actorId,at);
        let next=restoreLife(saveLife(fresh.state));
        const r=next.residents.find(r=>r.id===plan.actorId);if(!r?.reflection||r.reflection.day!==plan.day||!r.reflection.slots.includes(plan.slot)||r.reflection.lastAttemptAt!==now)return;
        if(valid&&answer.ok&&!invalid){next=applyReflection(next,plan,answer.output as ReflectionOutput,at);const reflected=next.residents.find(r=>r.id===plan.actorId)!.reflection!;reflected.outcome='live';reflected.lastReflectedAt=at;}
        else r.reflection.outcome=!valid?'discarded':invalid?'rejected':'unavailable';
        this.lifeStore!.saveInTransaction(this.worldId,fresh.revision,next);
      });
    }finally{release();}
  }

  private async meetingGate(s: WorldState, now: number): Promise<Hooks['canMeet']> {
    if (this.opts.meetingGate === 'off') return undefined;
    // Verification is never skipped and the world never stops: if the check cannot run, nobody meets this tick.
    const closed = (reason: string): NonNullable<Hooks['canMeet']> => (_s, a, b, place, at) => ({ok: false, event: {at, source: 'live', kind: 'meeting_refused', muse: a.id, other: b.id, place: place.id, line: 'Meeting paused: credentials could not be checked', data: {stage: 'verify', reason, dedup_key: `meeting:${[a.id, b.id].sort().join('|')}:${reason}:verify`}, tags: ['meeting_refused']}});
    if (typeof this.opts.meetingGate !== 'function') return closed('verification_not_configured');
    try { return await this.opts.meetingGate(s, now); } catch (e) {
      console.error('meeting gate failed', e);
      return closed('verification_unavailable');
    }
  }
  /** A refused meeting is logged once per pair and reason per window, across restarts. */
  private dedupMeetings(gate: NonNullable<Hooks['canMeet']>): NonNullable<Hooks['canMeet']> {
    return (st, a, b, place, at) => {
      const r = gate(st, a, b, place, at);
      const key = r.event?.data?.dedup_key;
      return !r.ok && typeof key === 'string' && !this.noteRefusal(key, at) ? {ok: false, event: null} : r;
    };
  }
  /** Summaries of windows closed inside a tick (the meeting gate cannot emit them itself). */
  private closedRepeats: Omit<WorldEvent, 'id' | 'tick'>[] = [];
  /** Deletes windows that ended; each one that suppressed repeats becomes a refusal_repeats event (repeat_count = occurrences). */
  private closeRefusalWindows(now: number): Omit<WorldEvent, 'id' | 'tick'>[] {
    const closed = this.sql.exec('SELECT key, first_at, last_at, count FROM refusals WHERE first_at <= ?', now - REFUSAL_WINDOW_MS).toArray();
    if (!closed.length) return [];
    this.sql.exec('DELETE FROM refusals WHERE first_at <= ?', now - REFUSAL_WINDOW_MS);
    return closed.filter(r => Number(r.count) > 1).map(r => ({at: now, source: 'live', kind: 'refusal_repeats', muse: null, line: null, data: {dedup_key: String(r.key), repeat_count: Number(r.count), suppressed: Number(r.count) - 1, first_at: Number(r.first_at), last_at: Number(r.last_at)}, tags: []}));
  }
  /** Counts a refusal; true when it opens a new window (log an event), false for a repeat inside the window. */
  noteRefusal(key: string, now: number) {
    this.closedRepeats.push(...this.closeRefusalWindows(now));
    const r = this.sql.exec('SELECT first_at FROM refusals WHERE key = ?', key).toArray()[0];
    if (r) { this.sql.exec('UPDATE refusals SET count = count + 1, last_at = ? WHERE key = ?', now, key); return false; }
    this.sql.exec('INSERT INTO refusals (key, first_at, last_at, count) VALUES (?, ?, ?, 1)', key, now, now);
    return true;
  }
  /**
   * The one refusal commit. It never moves the version (a refused request cannot make concurrent valid plans
   * stale) and writes nothing when nothing changed. With `dedup` (default) a repeat of `key` inside the window
   * is only counted; `dedup: false` always logs (evidence flows such as P0 must keep every event).
   */
  commitRefusal(now: number, label: string, key: string, mutate: (s: WorldState, emit: Emit) => void, dedup = true) {
    return this.commit(now, label, (st, emit) => {
      const fresh = this.noteRefusal(key, now);
      for (const e of this.closedRepeats.splice(0)) emit(e);
      if (!fresh && dedup) return;
      mutate(st, e => emit({...e, data: {...(e.data ?? {}), dedup_key: key}}));
    }, () => false, 'refusal', () => ({key})).events;
  }
  refusalCount(key: string) { return Number(this.sql.exec('SELECT count FROM refusals WHERE key = ?', key).toArray()[0]?.count ?? 0); }

  private reservationId(s: WorldState) { return `${this.opts.worldId}:${s.day}:${s.tick}:spotlight`; }
  private inFlight = new Set<string>();
  private tickTaken(s: WorldState) {
    const id = this.reservationId(s);
    if (this.inFlight.has(id)) return true;
    if (this.sql.exec('SELECT 1 FROM ticks WHERE day = ? AND tick = ?', s.day, s.tick).toArray().length) return true;
    this.inFlight.add(id);
    return false;
  }

  private async liveSpotlight(s: WorldState, muse: string, freedom: Decision['freedom'], now: number, activity=false): Promise<{decision: Decision | null; info: {source: string; reason?: string; requestId?: string | null}}> {
    // A paused Muse (owner revoked its delegation) has no turn: no model call, no fallback, no event.
    // Personal actors do not use the resident model/schema, even when presence is stale.
    if (isRuntimeControlled(s, muse, now)) return {decision: null, info: {source: 'scripted', reason: s.muses.find(m => m.id === muse)?.controlMode === 'personal' ? 'personal_muse' : 'connected_muse'}};
    if (s.paused?.[muse]) return {decision: null, info: {source: 'scripted'}};
    if(this.registryControls(muse))return {decision:null,info:{source:'scripted',reason:'registry_controlled_actor'}};
    // The world must never stop on one bad input: if the spotlight input cannot be built, the scenario continues.
    let input;
    try { input = validate('spotlight', spotlightInput(s, muse, freedom, now),this.trustedPersonalPeers(s));if(activity)input={...input,activities:residentActivityCatalog(s,muse,now)}; }
    catch (e) { return {decision: null, info: {source: 'scripted', reason: 'input_invalid: ' + String((e as Error).message).slice(0, 80)}}; }
    const fallback = (reason: string) => {
      if(reason === 'output_rejected:' + PUBLIC_SPEECH_NOT_ENGLISH) return {decision:null,info:{source:'rule',reason}};
      if(this.opts.residentBudgetEnabled&&isResidentBudgetRefusal(reason))return {decision:null,info:{source:'rule',reason}};
      const r = replayFor('spotlight', input);
      const out = r.output as Decision['output'] & {freedom?: string};
      // A recorded answer is used only if it was made for this freedom; otherwise the scenario continues.
      if (r.source === 'replay' && out?.freedom === freedom && (r.recorded as {muse?: string} | null)?.muse === muse) return {decision: {muse, freedom, source: 'replay' as const, output: out, evidence: {replayOf: r.recorded}}, info: {source: 'replay', reason}};
      return {decision: null, info: {source: muse===JUDGE_MUSE.id?'rule':'scripted', reason}};
    };
    // A connected Muse thinks in its owner's runtime (8.8): the team key never decides for it.
    if (!this.opts.model?.key) return fallback('not_connected');
    const context=residentContextForWorld(this.lifeStore?.load(this.worldId) ?? null,s,muse,now,activity&&this.opts.residentLife?{...this.opts.residentLife,ownershipKind:this.actionOwnership,includeOperatingResidents:true,includeRelationships:this.opts.residentReflection?.enabled===true}:{...this.opts.residentLife!,includeRelationships:this.opts.residentReflection?.enabled===true});
    const call = await this.modelCall('spotlight', input, this.reservationId(s),context,activity,{world:s,at:now});
    if (!call.ok) return fallback(call.reason);
    return {decision: {muse, freedom:activity?(call.output as ResidentActivityOutput).freedom:freedom, source: 'live', output: call.output as Decision['output'], evidence: call.evidence}, info: {source: 'live', requestId: call.evidence.requestId as string | null}};
  }

  /**
   * One model call for the world (C05): a free slot or no call, the maximum cost reserved under a deterministic id
   * (an alarm retry cannot reserve twice), the 8-second model deadline, then the real cost settled whatever the
   * answer was. The slot is released in every path, including a throw.
   */
  private async modelCall(action: 'spotlight' | 'encounter', input: Record<string, unknown>, id: string, residentContext:ResidentContext|null=null, activity=false,observation?:{world:WorldState;at:number}): Promise<{ok: true; output: unknown; evidence: Record<string, unknown>} | {ok: false; reason: string}> {
    const model = this.opts.model;
    if (!model?.key) return {ok: false, reason: 'not_connected'};
    const release = this.modelSlot();
    if (!release) return {ok: false, reason: 'concurrency_limit'};
    try {
      const jitter=this.opts.residentActions?.enabled?residentCallJitterMs(id,this.opts.residentActions.jitterMs??0):0;
      if(jitter){this.callHealth.waiting++;try{await(this.opts.waitForResidentCall?.(jitter)??new Promise<void>(resolve=>setTimeout(resolve,jitter)));}finally{this.callHealth.waiting--;}
        const current=this.state(),at=(this.opts.publicationNow??Date.now)();
        if(this.opts.residentActions?.enabled!==true||this.modelPriorityBlock(current,String(input.muse),at)||current.paused?.[String(input.muse)]||this.opts.delegationValid?.(String(input.muse))===false)return{ok:false,reason:'authority_changed_during_jitter'};
      }
      const signalWorld=activity&&this.opts.socialStatus?this.state():null,signalAt=signalWorld?(this.opts.publicationNow??Date.now)():0;
      const signalledInput=signalWorld&&this.opts.perception?.enabled!==true?{...input,public_availability:signalWorld.muses.map(m=>({actor_id:m.id,status:this.statusOf(signalWorld,m.id,signalAt)}))}:input;
      const brandedInput=this.opts.residentValuesEnabled===true?{...signalledInput,residentValuesEnabled:true}:signalledInput;
      const frame=observation??{world:this.state(),at:(this.opts.publicationNow??Date.now)()};
      const packet=this.opts.perception?.enabled===true?this.perceptionFor(String(input.muse),frame.at,frame.world):null;
      if(this.opts.perception?.enabled===true&&!packet)return{ok:false,reason:'perception_unavailable'};
      const modelInput=packet?bindPerceptionInput(brandedInput,packet,this.perceptionNotices(String(input.muse)),activity):brandedInput;
      if(packet&&action==='encounter'&&!observedActorId(modelInput,input.other))return{ok:false,reason:'recipient_not_observed'};
      const selectedContext=this.opts.residentActions?.fallbackRecovery?compactResidentContext(residentContext):residentContext;
      const messages = activity?activityMessages(modelInput,selectedContext):withResidentContext(buildMessages(action, modelInput),selectedContext);
      const personalPeer=action==='encounter'&&(input.other==='00-jolly'||typeof input.other==='string'&&this.opts.residentLife?.ownershipKind(input.other)==='personal');
      const res = this.opts.ledger.reserve({id, tier: 'world', session: 'world', ip: '', action, maxCostUsd: maxCostUsd(action, messages),...(this.opts.residentBudgetEnabled?{residentKind:residentKindFor(action,personalPeer)}:{})});
      if (!res.ok) return {ok: false, reason: res.reason};
      // Reserved before (a retried tick after a crash): that call was already made or paid for; never call twice.
      if (res.existing) return {ok: false, reason: 'already_reserved'};
      const health=this.callHealth;health.attempts++;health.active++;health.peak=Math.max(health.peak,health.active);
      let result:Awaited<ReturnType<typeof callModel>>;
      try{result=await callModel({...model,key:model.key},action,messages,activity?RESIDENT_ACTIVITY_SCHEMA:undefined);}
      finally{health.active--;}
      if(!result.ok&&result.kind==='timeout')health.timeouts++;
      if(Number.isFinite(result.latencyMs)){health.latencies.push(result.latencyMs);if(health.latencies.length>128)health.latencies.shift();}
      if (!result.ok) { this.opts.ledger.settle(id, failureCostUsd(result), result.kind === 'timeout' ? 'timeout' : 'error'); return {ok: false, reason: result.kind}; }
      const problem = activity?checkActivityOutput(modelInput,result.output):checkOutput(action, modelInput, result.output);
      this.opts.ledger.settle(id, actualCostUsd(result.usage), problem ? 'rejected' : 'live');
      if (problem) return {ok: false, reason: 'output_rejected:' + problem};
      const usage=providerUsageEvidence(result.usage);
      return {ok: true, output: result.output, evidence: {model: model.model, requestId: result.requestId, responseId: result.responseId, latencyMs: result.latencyMs, reservationId: id,perceptionMode:packet?'local-v1':'off',...(usage?{providerUsage:usage}:{}), ...(residentContext ? {residentLifeRevision:residentContext.revision} : {})}};
    } finally {
      release();
    }
  }

  /**
   * This tick's meetings (a dry run of the same pure tick on the same state, with the spotlight answer) and the other
   * Muse's answer to each: live when a slot and the budget allow, else rule with the reason. A connected Muse is not
   * answered for. Nothing is written here; the dry run's meeting gate is the undeduplicated one.
   */
  private async encounterReplies(s: WorldState, now: number, decision: Decision | null, canMeet: Hooks['canMeet'], turn: {muse: string; priority: boolean}, residentMove?:{muse:string;place:string;expectedVersion:number},residentIdle?:readonly string[],residentEnglishFallback?:string): Promise<EncounterReply[]> {
    let dry: WorldEvent[];
    const speechHooks=this.engineHooks(now); // Missing history is a failed turn, never an unfiltered dry-run fallback.
    try { dry = tick(s, {now, decision, replies: [], spot: turn,residentMove,residentIdle,residentFrozen:this.frozenResidents(s),residentGoalIdle:this.goalIdle(s,now),...(residentEnglishFallback?{residentEnglishFallback}:{})}, canMeet ? {...speechHooks, canMeet} : speechHooks).events; } catch (e) {
      console.error('encounter dry run failed', e);
      return [];
    }
    const meetings = dry.filter(e => e.kind === 'encounter' && e.other && e.muse && !isRuntimeControlled(s, e.other, now)&&!this.registryControls(e.other));
    // Budget kept for visitors, and a breaker after repeated timeouts: both answer by rule without a call.
    const budget = meetings.length ? this.opts.ledger.status() : null;
    const held = !this.opts.residentBudgetEnabled&&budget&&budget.remainingUsd < ENCOUNTER_BUDGET_FLOOR * budget.capUsd ? 'budget_reserved_for_visitors' : now < this.circuitOpenUntil ? 'circuit_open' : null;
    // Every slot is taken (or refused) before the first await, so the cap holds across this batch.
    return Promise.all(meetings.map((e, i) => {
      const muse = e.other!, other = e.muse!, place = e.place ?? s.muses.find(m => m.id === muse)!.place, meeting = String(e.data?.encounterId);
      const base = {muse, other, place, encounterId: meeting};
      const rule = (reason: string): EncounterReply => ({...base, source: 'rule', output: null, reason});
      if (i >= MAX_ENCOUNTER_REPLIES) return rule('turn_limit');
      if (held) return rule(held);
      const greeting = dry.find(g => g.kind === 'greet' && g.muse === other && g.other === muse)?.line ?? null;
      let input;
      try { input = validate('encounter', encounterInput(s, muse, other, place, greeting, now),this.trustedPersonalPeers(s)); } catch (err) { return rule('input_invalid: ' + String((err as Error).message).slice(0, 80)); }
      const context=residentContextForWorld(this.lifeStore?.load(this.worldId) ?? null,s,muse,now,this.opts.residentLife);
      return this.modelCall('encounter', input, `${this.opts.worldId}:${s.day}:${s.tick}:encounter:${muse}>${other}`,context,false,{world:s,at:now})
        .then((c): EncounterReply => { this.noteEncounterCall(c.ok ? 'ok' : c.reason, now); return c.ok ? {...base, source: 'live', output: c.output as EncounterReply['output'], evidence: {...c.evidence, encounterId: meeting}} : rule(c.reason); })
        .catch((err): EncounterReply => { console.error('encounter answer failed', err); return rule('error'); });
    }));
  }

  /** Meeting-answer timeouts in a row, and when the breaker closes again (memory only: a restart closes it). */
  private encounterTimeouts = 0;
  private circuitOpenUntil = 0;
  /** True while meeting answers are held by the breaker. */
  encounterCircuitOpen(now: number) { return now < this.circuitOpenUntil; }
  private noteEncounterCall(outcome: string, now: number) {
    // Only calls that reached the model count: a missing slot, budget or reservation says nothing about its health.
    if (isResidentBudgetRefusal(outcome)||['concurrency_limit', 'not_connected', 'session_quota', 'ip_quota', 'already_reserved'].includes(outcome)) return;
    if (outcome !== 'timeout') { this.encounterTimeouts = 0; return; }
    this.encounterTimeouts += 1;
    if (this.encounterTimeouts >= ENCOUNTER_TIMEOUTS_TO_OPEN) { this.encounterTimeouts = 0; this.circuitOpenUntil = now + ENCOUNTER_CIRCUIT_MS; }
  }

  /**
   * A visitor's (or a connected Muse's) request for the next spotlight turn (8.2): queued ahead of the rotation,
   * at most SPOTLIGHT_REQUESTS_PER_HOUR per requester. A Muse already waiting keeps its place and nothing is
   * written; a paused (revoked) Muse is refused. `requester` is an opaque id (never a raw session id). The world
   * version does not move (the queue is not part of any command's plan).
   */
  requestSpotlight(museId: string, now: number, by: {origin: SpotlightOrigin; requester: string}): SpotlightRequestResult {
    if(this.opts.residentActions?.enabled){
      const s=this.state(),m=s.muses.find(m=>m.id===museId);
      if(!m)return{ok:false,reason:'unknown_muse'};
      if(s.paused?.[museId]||isResidentFrozen(s,museId))return{ok:false,reason:'paused'};
      if(by.origin==='connected')return{ok:false,reason:'self_directed'}; // native action/event is already recorded
      const blocked=this.modelPriorityBlock(s,museId,now);
      if(blocked)return{ok:false,reason:blocked};
    }
    const recent = Number(this.sql.exec("SELECT COUNT(*) AS n FROM events WHERE kind = 'spotlight_requested' AND at > ? AND json_extract(data, '$.requester') = ?", now - 3_600_000, by.requester).toArray()[0]?.n ?? 0);
    const box: {out: SpotlightRequestResult} = {out: {ok: false, reason: 'unknown_muse'}};
    const done = this.commit(now, `spotlight-request-${museId}-${Math.random().toString(36).slice(2, 8)}`, (st, emit) => {
      const r = requestSpotlight(st, museId);
      if (!r.ok && r.reason === 'already_queued') { box.out = {ok: true, muse: museId, position: r.position!, already: true, eventIds: []}; return; }
      if (!r.ok) { box.out = {ok: false, reason: r.reason === 'already_queued' ? 'queue_full' : r.reason}; return; }
      // The limit is checked after the duplicate: asking again for a Muse already waiting costs nothing.
      if (recent >= SPOTLIGHT_REQUESTS_PER_HOUR[by.origin]) { st.spotlight.visitorQueue.pop(); box.out = {ok: false, reason: 'hourly_limit'}; return; }
      box.out = {ok: true, muse: museId, position: r.position, already: false, eventIds: []};
      emit({at: now, source: 'live', kind: 'spotlight_requested', muse: museId, line: null, data: {origin: by.origin, actorOrigin: by.origin === 'connected' ? 'connected' : 'trial', requester: by.requester, position: r.position}, tags: []});
      // The version does not move: the queue changes no command's validity, so a plan made against it stays current.
    }, () => false, 'external', () => ({spotlightRequest: {muse: museId, origin: by.origin}}));
    const out = box.out;
    return out.ok && !out.already ? {...out, eventIds: done.events.map(e => e.id)} : out;
  }

  /**
   * Commit point for actions outside the heartbeat (A2A trades, revocations, demo checks): the mutator runs
   * synchronously on the current state, then state, version and events are written together.
   */
  commitExternal(now: number, label: string, mutate: (s: WorldState, emit: Emit) => void, input?: () => {action: string; payload: unknown}) {
    // External decisions use the same per-action allow-list as signed commands; never store raw private inputs.
    return this.commit(now, label, mutate, () => true, 'external', input ? () => { const i = input(); return {action: i.action, ...commandFields(i.action, i.payload)}; } : undefined).events;
  }
  /**
   * Command commit point (C03), one transaction: `guard` runs first (stored-row re-check, nonce claim) and
   * may abort with a code before anything is written; then the mutation, the version (a refused rule bumps it
   * only when the state really changed), the events and the stored result row.
   */
  commitCommand(now: number, label: string, c: {guard: () => string | null; mutate: (s: WorldState, emit: Emit) => {ok: boolean}; record: (version: number, events: WorldEvent[]) => {actorId: string; commandId: string; action: string; payload?: unknown; row: CommandRow}; afterLog?: (done: {events: WorldEvent[]; row: CommandRow}) => void}): {aborted: string} | {aborted: null; events: WorldEvent[]; row: CommandRow} {
    return this.sql.transactionSync(() => {
      const aborted = c.guard();
      if (aborted) return {aborted};
      let ok = false, row: CommandRow | null = null, input: Record<string, unknown> | null = null;
      const done = this.write(now, label, (s, emit) => { ok = synchronous(c.mutate(s, emit)).ok; }, changed => ok || changed, 'command', () => input, (s, events) => {
        const rec = c.record(s.version, events);
        this.sql.exec('INSERT INTO commands (actor_id, command_id, payload_hash, action, result, output, at) VALUES (?, ?, ?, ?, ?, ?, ?)', rec.actorId, rec.commandId, rec.row.payloadHash, rec.action, JSON.stringify(rec.row.result), JSON.stringify(rec.row.output ?? null), now);
        row = rec.row;
        // The command as an ordered input (C08): who, which id and action, the redacted payload (approvals and answers
        // are commands) and its result. The signed envelope stays in the events' evidence.
        input = {actorId: rec.actorId, commandId: rec.commandId, action: rec.action, payloadHash: rec.row.payloadHash, ...commandFields(rec.action, rec.payload), ok: rec.row.result.ok, code: rec.row.result.error?.code ?? null, worldVersion: rec.row.result.worldVersion};
      });
      // Entry receipts depend on actual stored event/input/checkpoint ids. Still inside this transaction.
      if(c.afterLog)synchronous(c.afterLog({events:done.events,row:row!}));
      return {aborted: null, events: done.events, row: row!};
    });
  }
  commandRow(actorId: string, commandId: string): CommandRow | null {
    const r = this.sql.exec('SELECT payload_hash, result, output FROM commands WHERE actor_id = ? AND command_id = ?', actorId, commandId).toArray()[0];
    return r ? {payloadHash: String(r.payload_hash), result: JSON.parse(String(r.result)), output: JSON.parse(String(r.output))} : null;
  }

  private commit(now: number, label: string, mutate: (s: WorldState, emit: Emit) => void, bump: (changed: boolean) => boolean, kind: InputKind, input?: () => Record<string, unknown> | null) {
    return this.sql.transactionSync(() => this.write(now, label, mutate, bump, kind, input));
  }
  /** The body of a commit; callers hold the transaction (never nested). `after` runs before the run-log row is written. */
  private write(now: number, label: string, mutate: (s: WorldState, emit: Emit) => void, bump: (changed: boolean) => boolean, kind: InputKind, input?: () => Record<string, unknown> | null, after?: (s: WorldState, events: WorldEvent[]) => void) {
    const raw = this.raw();
    const s: WorldState = JSON.parse(raw), out: WorldEvent[] = [];
    // Current policy is authoritative before every external/signed mutation, not only after an alarm.
    setResidentFrozen(s,this.frozenResidents(s),now);
    let n = 0;
    synchronous(mutate(s, e => out.push({...e, id: `${s.day}:${s.tick}:${label}:${now}:${n++}`, tick: s.tick})) as unknown);
    // Task records (C06, I-07): revision and contentHash follow any content change this commit made (a counter, new
    // meetup candidates), and the approvals made on the old content are dropped, in the same transaction.
    syncTasks(s.inbox);
    if(this.residentSpeechEnabled()&&out.length)finalizeResidentSpeech(s,out,now,this.residentSpeechHistory(now));
    const changed = JSON.stringify(s) !== raw, bumped = bump(changed);
    if (bumped) s.version += 1;
    const afterRaw = JSON.stringify(s);
    if (changed || bumped) this.sql.exec('UPDATE world SET state = ?, version = ? WHERE id = 1', afterRaw, s.version);
    // External signed/public commands contribute only factual receipts, in this same rollback boundary.
    if(this.lifeStore&&this.opts.residentLife?.enabled===true&&out.length){
      const life=this.lifeStore.load(this.worldId);
      if(life){const next=rememberCommittedResidentEvents(life.state,s,out,now,id=>knownResident(id,this.opts.residentLife!.ownershipKind)&&!this.registryControls(id),JSON.parse(raw));
        if(saveLife(next)!==saveLife(life.state))this.lifeStore.saveInTransaction(this.worldId,life.revision,next);
      }
    }
    after?.(s, out);
    this.logCommit({at: now, kind, label, beforeRaw: raw, before: JSON.parse(raw), after: s, afterRaw, changed: changed || bumped, events: out, input: input?.() ?? null});
    this.notifyCommit(JSON.parse(raw),s,out,now);
    return {state: s, events: out};
  }

  /** Events after `sinceSeq` in order; with `day` only that world day (ids start with the day); with `tail` the newest N. */
  events(sinceSeq = 0, limit = 200, opts: {day?: string; tail?: number; runId?: string} = {}) {
    if (opts.runId) return this.rows(`SELECT ${EV_COLS} FROM events WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?`, opts.runId, sinceSeq, limit);
    if (opts.tail) return this.rows(`SELECT ${EV_COLS} FROM events ORDER BY seq DESC LIMIT ?`, Math.min(500, opts.tail)).reverse();
    const day = opts.day && /^\d{4}-\d{2}-\d{2}$/.test(opts.day) ? opts.day + ':%' : '%';
    return this.rows(`SELECT ${EV_COLS} FROM events WHERE seq > ? AND id LIKE ? ORDER BY seq LIMIT ?`, sinceSeq, day, limit);
  }
  private rows(q: string, ...b: unknown[]): LoggedEvent[] {
    return this.sql.exec(q, ...b).toArray().map(r => ({...r, data: JSON.parse(String(r.data)), tags: JSON.parse(String(r.tags))}) as LoggedEvent);
  }
  eventsOfKind(tick: number, kind: string) { return this.rows(`SELECT ${EV_COLS} FROM events WHERE tick = ? AND kind = ? ORDER BY seq`, tick, kind); }
  /** The newest events of one kind, newest first. */
  recentOfKind(kind: string, limit = 20) { return this.rows(`SELECT ${EV_COLS} FROM events WHERE kind = ? ORDER BY seq DESC LIMIT ?`, kind, limit); }
  /**
   * Highlights, newest first, one page at a time (C08, 8.6): `before` is the cursor (the seq of the last row of the
   * previous page), `from`/`to` the period (event time, `to` exclusive). The caller asks for the next page while a page
   * comes back full, so nothing beyond the first page is out of reach.
   */
  highlights(limit = 100, opts: {before?: number | null; from?: number | null; to?: number | null} = {}) {
    return this.rows(`SELECT ${EV_COLS} FROM events WHERE tags != '[]' AND seq < ? AND at >= ? AND at < ? ORDER BY seq DESC LIMIT ?`, opts.before ?? Number.MAX_SAFE_INTEGER, opts.from ?? 0, opts.to ?? Number.MAX_SAFE_INTEGER, limit);
  }
  /** One event with the commit that wrote it and its run (P2: highlight → run id + event id → inputs and evidence). */
  eventRecord(id: string) {
    const e = this.rows(`SELECT ${EV_COLS} FROM events WHERE id = ?`, id)[0];
    if (!e) return null;
    const runId = this.runLog.runOfEvent(e.runId ?? null), run = runId ? this.runLog.runById(runId) : null;
    const {initialSnapshot, ...head} = run ?? ({} as Partial<NonNullable<typeof run>>);
    return {event: e, runId, runIdStored: e.runId != null, input: e.inputSeq != null ? this.runLog.input(Number(e.inputSeq)) : null, run: run ? {...head, initialSnapshot: {hash: initialSnapshot!.hash, bytes: initialSnapshot!.body.length}} : null};
  }
  /**
   * The six autonomy measures recounted on the server from the run log (C09): one world, one period and optionally one
   * run. The period is `from`..`to` (ms, `to` exclusive) or one world `day` (Menlo Park; its ids start with the day, and
   * the time range around that day bounds the index scan). At most AUTONOMY_PERIOD_MAX_MS (a longer request keeps its
   * newest 48 hours) and AUTONOMY_SAMPLE_MAX events (the oldest ones); either limit makes the answer `partial`, never
   * silently complete. Events written before the run log belong to the pre-run-log run.
   */
  autonomy(q: {from?: number | null; to?: number | null; day?: string | null; runId?: string | null}, now = Date.now()) {
    const {sql, params, period, notes} = this.autonomyQuery(q, now);
    const evs = period ? this.rows(sql, ...params) : [];
    const capped = evs.length > AUTONOMY_SAMPLE_MAX, sample = (capped ? evs.slice(0, AUTONOMY_SAMPLE_MAX) : evs).sort((a, b) => a.seq - b.seq);
    if (capped) notes.push(`more than ${AUTONOMY_SAMPLE_MAX} events in the period: the oldest ${AUTONOMY_SAMPLE_MAX} are counted`);
    const pre = this.runLog.runs().find(r => r.origin === 'pre-run-log')?.runId ?? null;
    const runIds = [...new Set(sample.map(e => e.runId ?? pre ?? 'unrecorded'))];
    const scope = {worldId: this.opts.worldId, runIds, from: period?.from ?? null, to: period?.to ?? null, day: q.day ?? null, complete: !notes.length, partialReason: notes.length ? notes.join('; ') : null};
    const result = recountAutonomy(sample, scope);
    return {...result, partial: !scope.complete, values: values(result), byRun: runIds.length > 1 ? runIds.map(r => ({runId: r, values: values(recountAutonomy(sample.filter(e => (e.runId ?? pre ?? 'unrecorded') === r), {...scope, runIds: [r]}))})) : null};
  }
  /** The bounded sample query of autonomy() (exposed so the tests can EXPLAIN it): always an `at` range on an index. */
  autonomyQuery(q: {from?: number | null; to?: number | null; day?: string | null; runId?: string | null}, now = Date.now()) {
    const day = q.day && /^\d{4}-\d{2}-\d{2}$/.test(q.day) ? q.day : null, notes: string[] = [];
    let from = q.from ?? null, to = q.to ?? null;
    if (day) {
      // A Menlo Park day starts 7 or 8 hours after UTC midnight; 2 hours either side cover events of that day committed
      // just before or after the tick that turned the day.
      const base = Date.parse(day + 'T00:00:00Z');
      from = Math.max(from ?? -Infinity, base + 5 * 3_600_000); to = Math.min(to ?? Infinity, base + 34 * 3_600_000);
    }
    if (to === null) to = now;
    if (from === null) from = to - 24 * 3_600_000;
    if (to - from > AUTONOMY_PERIOD_MAX_MS) { from = to - AUTONOMY_PERIOD_MAX_MS; notes.push('the period is limited to 48 hours: the newest 48 hours are counted'); }
    const pre = this.runLog.runs().find(r => r.origin === 'pre-run-log')?.runId ?? null;
    const runId = q.runId ?? null;
    const runClause = runId ? (runId === pre ? ' AND (run_id = ? OR run_id IS NULL)' : ' AND run_id = ?') : '';
    // Ordered by time (the `at` index serves the range and the order); autonomy() puts the sample back in log order.
    const sql = `SELECT ${EV_COLS} FROM events WHERE at >= ? AND at < ?${day ? ' AND id LIKE ?' : ''}${runClause} ORDER BY at, seq LIMIT ?`;
    const params = [from, to, ...(day ? [day + ':%'] : []), ...(runId ? [runId] : []), AUTONOMY_SAMPLE_MAX + 1];
    return {sql, params, period: from < to ? {from, to} : null, notes};
  }
  /** Current public label only. Never persist private override reasons or inject into replay snapshots. */
  publicAvailability(actorId:string,now:number):{status:SocialStatus}|undefined {
    return this.availabilityIn(this.state(),actorId,now);
  }
  private availabilityIn(s:WorldState,actorId:string,now:number):{status:SocialStatus}|undefined {
    if(!this.opts.socialStatus||!s.muses.some(m=>m.id===actorId))return undefined;
    const value=this.opts.socialStatus(s,actorId,now);
    return{status:['welcoming','busy','do_not_disturb'].includes(value)?value:'do_not_disturb'};
  }
  /** Compact public view for clients: positions, current beats, inventories, spotlight. */
  view(now: number) {
    const s = this.state();
    return {worldId: s.worldId, day: s.day, tick: s.tick, version: s.version, lastTickAt: s.lastTickAt, nextSpotlight: spotlightFor(s, now), spotlightQueue: s.spotlight.visitorQueue.filter(id => !s.paused?.[id]), muses: s.muses.map(m => ({id: m.id,...(m.residentRole?{residentRole:m.residentRole}:{}),...(m.residentFrozenAt!==undefined?{residentFrozenAt:m.residentFrozenAt}:{}),...(m.profile?{profile:actorProfile(m.profile,m.id)}:{}), ...(this.opts.socialStatus?{availability:this.availabilityIn(s,m.id,now)}:{}),place: m.place, travel: m.travel, beat: m.beat, inventory: m.inventory, reflection: m.reflection, wants: m.wants, paused: s.paused?.[m.id] ?? null}))};
  }
}
