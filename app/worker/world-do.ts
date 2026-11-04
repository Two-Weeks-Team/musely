import {losePersonalClaim} from './core/personal-claim-loss.ts';
import {PersonalClaims,type ClaimFlowBinding} from './core/personal-claims.ts';
import {LegacyProfile,type LegacyOwnerProof} from './core/legacy-profile.ts';
import {PersonalAdoption} from './core/personal-adoption.ts';
import {PersonalLegacy} from './core/personal-legacy.ts';
import {ReceiptSnapshots} from './core/receipt-snapshots.ts';
import {canonicalize} from '../src/identity/jcs.ts';
import {readOwnerSession,type OwnerTokens} from './core/owner-session.ts';
import {PersonalRegistryError} from './core/personal-owners.ts';
import {PersonalWorld} from './core/personal-world.ts';
// The single shared world Durable Object: budget and quota ledger, the heartbeat and commit point,
// the append-only run log, the trust registry and the owner claim (direction v2, 6, 8.7, 15).
import {DurableObject} from 'cloudflare:workers';
import {Ledger, type ReserveRequest, type Outcome, type Tier} from './core/ledger.ts';
import {residentBudgetFromEnv} from './core/resident-budget-policy.ts';
import {residentPersona} from './core/actions.ts';
import type {Env} from './env.ts';
import type {ClaimRecord} from './core/threads.ts';
import {WorldRuntime} from './core/world-runtime.ts';
import {WorldLifeController,worldLifeEnabled,WORLD_LIFE_PLACES} from './core/world-life-controller.ts';
import {TICK_MS} from '../src/engine/world.ts';
import {makeHooks} from '../src/engine/rules.ts';
import {Trust, OWNER_SLOT} from './core/trust.ts';
import {runP0, impostorCheck, injectionCheck, MeetingCheck, type Ctx} from './core/a2a.ts';
import {ConnectedHost} from './core/connected.ts';
import {RitualStore, type RitualRecord} from './core/ritual.ts';
import {revokeMuse, redelegateMuse, reconcilePaused, delegationStatus} from './core/owner-control.ts';
import {resetMuse} from './core/muse-reset.ts';
import {initRetention, pruneCommands, RETENTION_CHECK_MS} from './core/data-retention.ts';
import {migrateTaskStore, type DecisionInput} from './core/tasks.ts';
import {PersonalAuthStore, type PersonalFlow, type PersonalSessionRow} from './core/personal-session.ts';
import {PersonalRegistration, type PersonalBinding} from './core/personal-registration.ts';
import {SocialStatusStore,SocialStatusError} from './core/social-status.ts';
import {resolveSocialStatus} from '../src/engine/social-status.ts';
import type {WorldState} from '../src/engine/world.ts';
import {PRINCIPALS} from './core/owner-session.ts';
type SocialBinding={kind:'legacy';proof:LegacyOwnerProof}|{kind:'personal';binding:PersonalBinding};
import {CONNECTED_MS} from '../src/engine/inbox.ts';

export class WorldDO extends DurableObject<Env> {
  private ledger: Ledger;
  private legacyProfile:LegacyProfile;
  private personalAdoption:PersonalAdoption;
  private personalLegacy:PersonalLegacy;
  private receiptSnapshots:ReceiptSnapshots;
  private personalAuth: PersonalAuthStore;
  private personalRegistration: PersonalRegistration;
  private personalWorld: PersonalWorld;
  private personalClaims:PersonalClaims;
  private socialStatus:SocialStatusStore<SocialBinding>|null=null;
  private runtime: WorldRuntime;
  private worldLife: WorldLifeController|null=null;
  private trust: Trust;
  private ritual: RitualStore;
  private ownerRoot: JsonWebKey | null;
  private connected: ConnectedHost;
  private origin: string;
  private meetings = new MeetingCheck(() => this.ctx_());
  private retentionAt = 0;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.origin = env.PUBLIC_ORIGIN;
    if (!this.origin) throw new Error('PUBLIC_ORIGIN is not set');
    this.personalAuth = new PersonalAuthStore(ctx.storage);
    this.receiptSnapshots=new ReceiptSnapshots(ctx.storage.sql);
    this.personalRegistration = new PersonalRegistration(ctx.storage, this.personalAuth,{reservedPrincipal:id=>this.personalAdoption?.hasPrincipal(id)??false});
    const residentBudget=residentBudgetFromEnv(env);
    this.ledger = new Ledger(ctx.storage.sql, {dailyCapUsd: residentBudget ? Number(env.DAILY_BUDGET_USD??'30') : Number(env.DAILY_BUDGET_USD) || 20,residentBudget});
    this.trust = new Trust(ctx.storage.sql);
    this.ritual = new RitualStore(ctx.storage.sql);
    this.ownerRoot = env.OWNER_ROOT_JWK ? JSON.parse(env.OWNER_ROOT_JWK) : null;
    const hooks = makeHooks();
    // The registry's current proof decides personal participation; a pm_ prefix is never authority.
    // MeetingCheck still verifies both signed Cards/delegations and rechecks their exact proof at commit.
    hooks.canProposeTrade = (_s,a,b,_give,_want,at) => [a,b].every(id => {
      const agent=this.trust.agentByMuse(id);
      if(!id.startsWith('pm_')&&agent?.kind!=='personal')return true;
      return agent?.kind==='personal'&&!this.trust.suspended(id)&&this.trust.personalClaim(id,at).claimed;
    });
    // The runtime commits inside the storage transaction; every other store shares the same SQL handle.
    const txSql = {exec: (q: string, ...b: unknown[]) => ctx.storage.sql.exec(q, ...b), transactionSync: <T>(fn: () => T) => ctx.storage.transactionSync(fn)};
    const active=()=>worldLifeEnabled(env.WORLD_LIFE_MODE);
    const valuesMode=env.RESIDENT_VALUES_MODE;
    if(valuesMode!==undefined&&valuesMode!==''&&valuesMode!=='off'&&valuesMode!=='confirmed-v1')throw Error('unsupported_RESIDENT_VALUES_MODE');
    const valuesEnabled=valuesMode==='confirmed-v1';
    if(valuesEnabled)hooks.residentValuesEnabled=true;
    const socialMode=env.SOCIAL_STATUS_MODE;
    if(socialMode!==undefined&&socialMode!==''&&socialMode!=='off'&&socialMode!=='public-v1')throw Error('unsupported_SOCIAL_STATUS_MODE');
    const socialEnabled=socialMode==='public-v1';
    const currentSocialStatus=(state:WorldState,actorId:string,now:number)=>{
      try{return resolveSocialStatus(state,actorId,now,this.socialStatus?.override(actorId)??'do_not_disturb',valuesEnabled);}
      catch{return 'do_not_disturb' as const;}
    };
    if(socialEnabled)hooks.socialStatus=currentSocialStatus;
    const actionMode=env.RESIDENT_ACTIONS_MODE;
    if(actionMode!==undefined&&actionMode!==''&&actionMode!=='off'&&actionMode!=='action-v1')throw Error('unsupported_RESIDENT_ACTIONS_MODE');
    const actionsEnabled=actionMode==='action-v1',actionConcurrency=Number(env.RESIDENT_ACTION_MAX_CONCURRENT??'4');
    if(actionsEnabled&&(!active()||!residentBudget))throw Error('resident_actions_require_world_life_and_split_budget');
    if(actionsEnabled&&(!Number.isSafeInteger(actionConcurrency)||actionConcurrency<1||actionConcurrency>8))throw Error('invalid_RESIDENT_ACTION_MAX_CONCURRENT');
    const jitterMs=Number(env.RESIDENT_CALL_JITTER_MS??'0');
    if(!Number.isSafeInteger(jitterMs)||jitterMs<0||jitterMs>2000)throw Error('invalid_RESIDENT_CALL_JITTER_MS');
    const fallbackMode=env.RESIDENT_FALLBACK_MODE;
    if(fallbackMode!==undefined&&fallbackMode!==''&&fallbackMode!=='off'&&fallbackMode!=='short-v1')throw Error('unsupported_RESIDENT_FALLBACK_MODE');
    const reflectionMode=env.RESIDENT_REFLECTION_MODE;
    if(reflectionMode!==undefined&&reflectionMode!==''&&reflectionMode!=='off'&&reflectionMode!=='private-v1')throw Error('unsupported_RESIDENT_REFLECTION_MODE');
    const reflectionEnabled=reflectionMode==='private-v1';
    if(reflectionEnabled&&(!valuesEnabled||!active()||!residentBudget))throw Error('reflection_requires_confirmed_values_world_life_and_split_budget');
    if(active())this.worldLife=new WorldLifeController(txSql,this.personalAuth.owners,this.trust,this.ledger,env.MODEL_API_KEY?{base:env.MODEL_BASE,key:env.MODEL_API_KEY,model:env.MODEL_ID,timeoutMs:8000}:null,muse=>this.personalWorld.ownerOf(muse),active);
    this.runtime = new WorldRuntime(txSql, {
      ...this.worldLife?.runtimeOptions(),
      ...(valuesEnabled?{residentValuesEnabled:true}:{}),
      ...(reflectionEnabled?{residentReflection:{enabled:true,persona:residentPersona}}:{}),
      ...(socialEnabled?{socialStatus:currentSocialStatus}:{}),
      ...(actionsEnabled?{residentActions:{enabled:true,maxConcurrent:actionConcurrency,jitterMs,fallbackRecovery:fallbackMode==='short-v1'},operatingResidentControl:(id:string,now:number)=>this.operatingResidentControl(id,now)}:{}),
      // Live decisions for a Muse whose delegation was revoked (and not re-issued) are discarded.
      delegationValid: museId => !this.trust.suspended(museId),
      // Every meeting: both Agent Cards and delegations are verified before any greeting or trade.
      meetingGate: async (s, now) => {const gate=await this.meetings.prepare(s,now);this.worldLife?.acceptMeetingGate(s,now,gate);return gate;},
      worldId: 'musely',
      ledger: this.ledger,
      residentBudgetEnabled:residentBudget?.enabled===true,
      hooks,
      model: {base: env.MODEL_BASE, key: env.MODEL_API_KEY, model: env.MODEL_ID, timeoutMs: 8000},
    });
    this.worldLife?.bind(this.runtime);
    // Stable personal/legacy ownership never falls back to resident consent when login is unavailable.
    this.personalClaims=new PersonalClaims(ctx.storage,this.personalAuth,{secret:env.SESSION_SECRET??'',appId:env.THREADS_APP_ID??'',appSecret:env.THREADS_APP_SECRET??'',redirectUri:this.origin+'/api/threads/callback'},(actor,status,version)=>losePersonalClaim(this.runtime,this.trust,actor,status,version,Date.now()));
    this.trust.setPersonalClaimRefresh(actor=>this.personalClaims.refresh(actor));
    this.legacyProfile=new LegacyProfile(ctx.storage,this.runtime);
    this.personalWorld=new PersonalWorld(ctx.storage,this.personalAuth,this.personalRegistration,this.runtime,this.trust,this.origin,hooks,{root:()=>this.ownerRoot,claimed:()=>this.getClaim('owner-muse')?.status==='claimed'});
    this.connected = new ConnectedHost({campfires:this.worldLife?{get enabled(){return active();},placeIds:WORLD_LIFE_PLACES}:undefined,personal:this.personalWorld,sql: ctx.storage.sql, trust: this.trust, runtime: this.runtime, hooks, baseUrl: this.origin, ownerRoot: () => this.ownerRoot, ownerClaimed: () => this.getClaim('owner-muse')?.status === 'claimed', ownerOf: muse => this.worldLife?this.worldLife.ownerOf(muse,id=>this.personalWorld.ownerOf(id)):this.personalWorld.ownerOf(muse)});
    this.personalAdoption=new PersonalAdoption(ctx.storage,this.personalAuth,{
      currentLegacy:()=>{const agent=this.trust.agentByMuse(OWNER_SLOT);if(!agent)throw new PersonalRegistryError('adoption_unavailable');const{kty,crv,x,y}=agent.rootJwk;return{actorId:OWNER_SLOT,agentId:agent.agentId,rootBinding:canonicalize({kty,crv,x,y}),worldId:this.runtime.worldId,profile:this.legacyProfile.view()};},
      commitProfile:(owner,input)=>{const profile=this.legacyProfile.patch(owner,input),commit=this.runtime.runLog.lastInput();if(!commit)throw new PersonalRegistryError('adoption_unavailable');const event=ctx.storage.sql.exec("SELECT seq,id FROM events WHERE run_id=? AND input_seq=? AND kind='legacy_profile_updated' AND muse=? ORDER BY seq DESC LIMIT 1",commit.runId,commit.seq,OWNER_SLOT).toArray()[0];if(!event)throw new PersonalRegistryError('adoption_unavailable');if(!commit.afterSnapshot&&commit.afterSnapshotError==='replay_storage_limit')this.receiptSnapshots.put({kind:'legacy_adoption',actorId:OWNER_SLOT,worldId:this.runtime.worldId,runId:commit.runId,inputSeq:commit.seq,eventId:String(event.id),afterHash:commit.afterHash},this.runtime.state());return{profile,commit:{worldId:this.runtime.worldId,runId:commit.runId,inputSeq:commit.seq,eventSeq:Number(event.seq),eventId:String(event.id),afterHash:commit.afterHash}};},
    });
    this.personalLegacy=new PersonalLegacy({storage:ctx.storage,auth:this.personalAuth,adoption:this.personalAdoption,runtime:this.runtime,trust:this.trust,connected:this.connected,legacyProfile:this.legacyProfile});
    if(socialEnabled)this.socialStatus=new SocialStatusStore(ctx.storage,{residentValuesEnabled:valuesEnabled,world:()=>this.runtime.state(),authorize:(binding,muse,now)=>this.authorizeSocialStatus(binding,muse,now)});
    ctx.blockConcurrencyWhile(async () => {
      this.ledger.init();
      this.personalAuth.init();
      this.personalAdoption.init();
      this.personalRegistration.init();
      this.runtime.init(Date.now());
      this.worldLife?.init();
      // Task records version 2 (C06, I-07): migrates a stored version 1 inbox once, before any other commit; a restart writes nothing.
      migrateTaskStore(this.runtime, Date.now());
      initRetention(ctx.storage.sql);
      // The heartbeat (direction v2, 8.7): one alarm per minute keeps the shared world running.
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + 5_000);
      // Owner claims. The Threads token stays inside this object; no method returns it over HTTP.
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS claims (agent TEXT PRIMARY KEY, record TEXT NOT NULL, token TEXT)');
      this.trust.init();
      this.personalWorld.init();
      this.personalClaims.init();
      this.socialStatus?.init();
      this.legacyProfile.init();
      this.connected.init();
      this.ritual.init();
      if(this.worldLife)await this.worldLife.ensureAgents(this.ownerRoot);else await this.trust.ensureAgents(this.ownerRoot);
      // The world's paused Muses always match the registry's revoked ones (C06).
      reconcilePaused({trust: this.trust, runtime: this.runtime});
      // The owner's Muse arrives with a small welcome gift so it has something to trade (logged as a rule).
      const owner = this.runtime.state().muses.find(m => m.id === OWNER_SLOT);
      if (owner && owner.inventory.length === 0) this.runtime.commitExternal(Date.now(), 'welcome', (st, emit) => { st.muses.find(m => m.id === OWNER_SLOT)!.inventory.push('coffee', 'postage_stamp'); emit({at: Date.now(), source: 'rule', kind: 'welcome_gift', muse: OWNER_SLOT, line: 'Welcome gift: Coffee and a Postage Stamp', data: {items: ['coffee', 'postage_stamp']}, tags: []}); });
    });
  }
  /** Read-only handoff for the two operator-owned residents. Ownership, signing and grants never change. */
  private operatingResidentControl(id:string,now:number):'resident'|'connected'|'unknown' {
    try{
      if(!['04-ember','09-copper'].includes(id)||!Number.isSafeInteger(now)||now<0)return 'unknown';
      const actor=this.runtime.state().muses.find(m=>m.id===id),agent=this.trust.agentByMuse(id);
      if(!actor||actor.profile||actor.controlMode==='personal'||this.runtime.state().paused?.[id]||agent?.kind!=='resident'||this.trust.suspended(id))return 'unknown';
      const last=this.connected.keys.lastActiveUse(id);
      if(last===null)return 'resident';
      if(!Number.isSafeInteger(last)||last<0||last>now)return 'unknown';
      return now-last<CONNECTED_MS?'connected':'resident';
    }catch{return 'unknown';}
  }
  // Private auth RPCs. Login tokens stay in memory; explicit claim tokens are stored only as private ciphertext, never in world commits.
  legacyProfileGet(owner:LegacyOwnerProof){return this.legacyProfile.get(owner);}
  legacyProfilePatch(owner:LegacyOwnerProof,input:unknown){return this.legacyProfile.patch(owner,input);}
  private socialStore(){if(!this.socialStatus)throw new SocialStatusError('social_status_unavailable');return this.socialStatus;}
  private authorizeSocialStatus(binding:SocialBinding,muse:string,now:number):boolean {
    try{
      if(binding.kind==='legacy'){
        const p=binding.proof,principal=p&&PRINCIPALS[p.principal];
        return !!principal&&p.ownerId===principal.ownerId&&Number.isSafeInteger(p.exp)&&p.exp>now&&principal.muses.includes(muse);
      }
      if(binding.kind!=='personal')return false;
      return this.personalProfileRead(binding.binding)?.actorId===muse;
    }catch{return false;}
  }
  ownerSocialStatusGet(owner:LegacyOwnerProof,muse:string){return this.socialStore().get({kind:'legacy',proof:owner},muse);}
  ownerSocialStatusSet(owner:LegacyOwnerProof,muse:string,input:unknown){return this.socialStore().set({kind:'legacy',proof:owner},muse,input);}
  personalSocialStatusGet(binding:PersonalBinding){const store=this.socialStore(),profile=this.personalProfileRead(binding);if(!profile)throw new SocialStatusError('social_status_forbidden');return store.get({kind:'personal',binding},profile.actorId);}
  personalSocialStatusSet(binding:PersonalBinding,input:unknown){const store=this.socialStore(),profile=this.personalProfileRead(binding);if(!profile)throw new SocialStatusError('social_status_forbidden');return store.set({kind:'personal',binding},profile.actorId,input);}
  personalLocation(binding:PersonalBinding){return this.personalWorld.location(binding);}
  personalLocationSet(binding:PersonalBinding,input:unknown){return this.personalWorld.setLocation(binding,input);}
  personalClaimRead(binding:PersonalBinding){return this.personalClaims.describe(binding);}
  personalClaimRevoke(binding:PersonalBinding,input:unknown){return this.personalClaims.revoke(binding,input);}
  personalClaimBegin(binding:PersonalBinding,input:unknown,flow:PersonalFlow){return this.personalClaims.begin(binding,input,flow);}
  personalClaimComplete(binding:ClaimFlowBinding,code:string|null){return this.personalClaims.complete(binding,code);}
  personalStatus(binding:PersonalBinding|null){if(binding&&this.personalAdoption.hasPrincipal(binding.proof.principalId)){this.guardAdoptionBinding(binding);return{kind:'legacy_adoption',...this.personalLegacy.view(binding,null)};}return this.personalWorld.status(binding);}
  personalAuthorityOwn(binding:PersonalBinding){return this.personalWorld.authorityOwn(binding);}
  personalAuthorityGrant(binding:PersonalBinding,input:unknown){return this.personalWorld.grant(binding,input);}
  personalAuthorityRevoke(binding:PersonalBinding,input:unknown){return this.personalWorld.revoke(binding,input);}
  personalKeyIssue(binding:PersonalBinding,input:unknown){return this.personalWorld.authority.issueKey(binding,input);}
  personalKeys(binding:PersonalBinding){return this.personalWorld.authority.listKeys(binding);}
  personalKeyRevoke(binding:PersonalBinding,id:string){return this.personalWorld.authority.revokeKey(binding,id);}
  personalAttemptCreate(binding:PersonalBinding,input:unknown){return{attempt:this.personalWorld.entry.create(binding,input),entry:this.personalWorld.entry.project(binding)};}
  personalAttemptRead(binding:PersonalBinding,id:string){return{attempt:this.personalWorld.entry.read(binding,id),entry:this.personalWorld.entry.project(binding)};}
  personalAttemptCancel(binding:PersonalBinding,id:string){return{attempt:this.personalWorld.entry.cancel(binding,id),entry:this.personalWorld.entry.project(binding)};}
  personalDraftRegister(binding: PersonalBinding, input: unknown) { return this.personalRegistration.register(binding, input); }
  personalProfileRead(binding: PersonalBinding) { this.guardAdoptionBinding(binding);return this.personalLegacy.profile(binding)??this.personalRegistration.profile(binding); }
  personalProfilePatch(binding: PersonalBinding, input: unknown) { this.guardAdoptionBinding(binding);return this.personalAdoption.hasPrincipal(binding.proof.principalId)?this.personalLegacy.patchProfile(binding,input):this.personalWorld.patchProfile(binding,input); }
  private guardAdoptionBinding(binding:PersonalBinding){if(!binding||binding.appId!==this.env.THREADS_APP_ID||!this.personalAuth.active(binding.sidDigest,binding.proof,binding.appId,Date.now()))throw new PersonalRegistryError('personal_session_required');}
  private async adoptionOwner(cookie:string|null):Promise<LegacyOwnerProof|null>{const tokens:OwnerTokens={owner:this.env.OWNER_CONTROL_TOKEN,peer:this.env.DEMO_PEER_CONTROL_TOKEN,reviewer:this.env.REVIEWER_CONTROL_TOKEN,judge:this.env.JUDGE_TOKEN};const owner=await readOwnerSession(this.env.SESSION_SECRET??'',cookie,tokens);return owner?.principal==='owner'?{principal:owner.principal,ownerId:owner.ownerId,exp:owner.exp}:null;}
  async personalLegacyView(binding:PersonalBinding,ownerCookie:string|null){this.guardAdoptionBinding(binding);const owner=this.personalAdoption.hasPrincipal(binding.proof.principalId)?null:await this.adoptionOwner(ownerCookie);this.guardAdoptionBinding(binding);return this.personalLegacy.view(binding,owner);}
  async personalLegacyAdopt(binding:PersonalBinding,ownerCookie:string|null,input:unknown){this.guardAdoptionBinding(binding);const owner=await this.adoptionOwner(ownerCookie);this.guardAdoptionBinding(binding);if(!owner)throw new PersonalRegistryError('owner_session_required');return this.personalLegacy.adopt(binding,owner,input);}
  personalLegacyInbox(binding:PersonalBinding){this.guardAdoptionBinding(binding);return this.personalLegacy.inbox(binding);}
  personalLegacyApprove(binding:PersonalBinding,input:unknown){this.guardAdoptionBinding(binding);return this.personalLegacy.approve(binding,input);}
  personalAuthBegin(flow: PersonalFlow) { return this.personalAuth.begin(flow); }
  personalAuthConsume(binding: Pick<PersonalFlow, 'stateDigest' | 'browserDigest' | 'appId' | 'redirectUri'>, now: number) { return this.personalAuth.consume(binding, now); }
  personalAuthFailure(binding: Parameters<PersonalAuthStore['fail']>[0], detail: Parameters<PersonalAuthStore['fail']>[1], now: number) { return this.personalAuth.fail(binding, detail, now); }
  personalAuthComplete(stateDigest: string, appId: string, subject: string, sidDigest: string, now: number) { return this.personalAuth.complete(stateDigest, appId, subject, sidDigest, now); }
  personalAuthActive(sidDigest: string, proof: PersonalSessionRow, appId: string, now: number) { return this.personalAuth.active(sidDigest, proof, appId, now); }
  personalAuthRevoke(sidDigest: string, proof: PersonalSessionRow, appId: string, now: number) { return this.personalAuth.revoke(sidDigest, proof, appId, now); }
  reserve(r: ReserveRequest) { return this.ledger.reserve(r); }
  settle(id: string, costUsd: number, outcome: Outcome) { return this.ledger.settle(id, costUsd, outcome); }
  status() { this.ledger.prune(); return {...this.ledger.status(),residentExecution:this.runtime.modelExecutionStatus()}; }
  quota(session: string, tier: Tier) { return this.ledger.quotaFor(session, tier); }
  async alarm() {
    try {
      if(this.worldLife){const s=this.runtime.state(),now=Date.now();this.worldLife.acceptMeetingGate(s,now,await this.meetings.prepare(s,now));}
      const r = await this.runtime.heartbeat(Date.now());
      if (r.status === 'committed') console.log('heartbeat', r.tick, r.spotlight?.muse, r.spotlight?.source, r.spotlight?.reason ?? '', 'replies', r.replies?.live ?? 0, 'live', r.replies?.rule ?? 0, 'rule');
    } finally {
      // Retention (G-09): command result rows older than 7 days go, checked at most once an hour.
      try { const now = Date.now(); if (now - this.retentionAt >= RETENTION_CHECK_MS) { this.retentionAt = now; pruneCommands(this.ctx.storage.sql, now); } } catch (e) { console.error('retention failed', e); }
      // Always schedule the next beat, even if this one threw (the runtime is idempotent per tick).
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    }
  }
  private ctx_(): Ctx {
    const claim = this.getClaim('owner-muse');
    return {trust: this.trust, runtime: this.runtime, ownerRoot: this.ownerRoot, ownerClaimed: claim?.status === 'claimed', baseUrl: this.origin};
  }
  p0(by?: 'judge' | 'owner') { return runP0({...this.ctx_(), requestedBy: by}); }
  impostor(target: string) { return impostorCheck(this.ctx_(), target); }
  injection(from: string, to: string, i: number) { return injectionCheck(this.ctx_(), from, to, i); }
  async agentCard(museId: string) {
    if (!this.trust.agentByMuse(museId)) return null;
    const claim = this.getClaim('owner-muse');
    return this.trust.card(museId, this.ownerRoot, {claimed: claim?.status === 'claimed', fingerprint: museId === OWNER_SLOT ? claim?.fingerprint ?? null : null}, this.origin);
  }
  jwks(kid: string) { const a = this.trust.agentById(kid); return a ? {keys: [{...a.rootJwk, kid: a.agentId, alg: 'ES256', use: 'sig'}]} : null; }
  ritualStart(session: string) { return this.ritual.start(session); }
  ritualTake(id: string, session: string) { return this.ritual.take(id, session); }
  ritualOwnerRecord() { return this.ritual.ownerRecord(); }
  /**
   * Logs a judged ritual (verdicts only, never frames). Only a passing live run made with the real owner's session
   * becomes the owner's recorded ritual; a judge link or a visitor never writes it, and the record grants nothing.
   */
  ritualRecord(rec: RitualRecord, sessionTag: string, byOwner = false) {
    if (byOwner && rec.passed) this.ritual.saveOwnerRecord(rec);
    // A unique label: two rituals judged in the same millisecond must not share an event id (the second would be dropped).
    return this.runtime.commitExternal(Date.now(), 'ritual-' + Math.random().toString(36).slice(2, 10), (_s, emit) => emit({at: Date.now(), source: rec.requestId ? 'live' : 'replay', kind: 'ritual_judged', muse: null, line: rec.passed ? 'Welcome ritual passed' : 'Welcome ritual not passed', data: {passed: rec.passed, results: rec.results, evidence: rec.requestId ? {model: rec.model, requestId: rec.requestId} : null, who: byOwner ? 'owner (owner session)' : rec.tier === 'judge' ? 'judge link ' + sessionTag : 'visitor ' + sessionTag, framesStored: false, ...(byOwner ? {actor: 'owner'} : {actorOrigin: 'trial'})}, tags: ['ritual']}));
  }
  worldView() { return this.runtime.view(Date.now()); }
  worldLifeView() { return worldLifeEnabled(this.env.WORLD_LIFE_MODE)?this.worldLife?.view()??null:null; }
  /** A visitor's priority spotlight request (8.2); the Worker route checks the session and passes an opaque requester id. */
  requestSpotlight(muse: string, origin: 'visitor' | 'judge', requester: string) {
    if (this.trust.suspended(muse)) return {ok: false as const, reason: 'paused' as const};
    return this.runtime.requestSpotlight(muse, Date.now(), {origin, requester});
  }
  worldEvents(since: number, limit: number, opts: {day?: string; tail?: number; runId?: string} = {}) { return this.runtime.events(since, Math.min(2000, Math.max(1, limit)), opts); }
  /** One page of highlights (at most 300), newest first; `before` is the cursor of the next page, `from`/`to` the period. */
  worldHighlights(limit: number, opts: {before?: number | null; from?: number | null; to?: number | null} = {}) { return this.runtime.highlights(Math.min(300, Math.max(1, limit)), opts); }
  // Run log (8.6, C08, C09): the current run, its ordered inputs, one event with its commit, the server recount.
  worldRun(runId?: string | null, snapshot = false) {
    const s = this.runtime.state(), log = this.runtime.runLog;
    if (!runId) return log.summary(s);
    const r = log.runById(runId);
    if (!r) return null;
    const readThrough = log.boundary(runId);
    return snapshot ? {...r, readThrough} : {...r, readThrough, initialSnapshot: {hash: r.initialSnapshot.hash, bytes: r.initialSnapshot.body.length}};
  }
  worldRunInputs(runId: string, since: number, limit: number) {
    const log = this.runtime.runLog, record = log.runById(runId);
    if (!record) return null;
    // V2 rows carry a checkpoint: bound a public response as well as each row/run. Callers page by seq, not page length.
    const rows = log.inputs(runId, since, record.schemaVersion === 'run-log-2' ? Math.min(16, limit) : limit);
    let bytes = 2; const out: typeof rows = [];
    for (const row of rows) {
      const size = new TextEncoder().encode(JSON.stringify(row)).byteLength + 1;
      if (out.length && bytes + size > 2 * 1024 * 1024) break;
      out.push(row); bytes += size;
    }
    return out;
  }
  worldEvent(id: string) { return this.runtime.eventRecord(id); }
  worldAutonomy(q: {from?: number | null; to?: number | null; day?: string | null; runId?: string | null}) { return this.runtime.autonomy(q); }
  // Connected Muse (direction v2, 7.2, 12.3, 13.1): MCP dispatch, agent keys, owner location, notifications.
  mcp(keyHash: string, method: string, params: unknown, isNotification: boolean) { return this.connected.mcp(keyHash, method, params, isNotification); }
  mcpAuth(keyHash: string) { return this.connected.authenticate(keyHash); }
  issueAgentKey(muse: string) { return this.connected.issueKey(muse); }
  listAgentKeys(muse: string) { return this.connected.listKeys(muse); }
  agentKeyMuse(id: string) { return this.connected.keyMuse(id); }
  revokeAgentKey(id: string) { return this.connected.revokeKey(id); }
  purgeAgentKey(id: string, by: string) { return this.connected.purgeKey(id, by); }
  // Reviewer Muse reset (G-08); the Worker route checks the reviewer session.
  resetMuse(muse: string, by: string) { return resetMuse({trust: this.trust, runtime: this.runtime}, muse, by); }
  // Owner control (C06, I-02): revocation and the separate re-delegation; the Worker route checks the owner session.
  ownerRevoke(muse: string, by: string) { return revokeMuse({trust: this.trust, runtime: this.runtime}, muse, by); }
  ownerRedelegate(muse: string, by: string) { return redelegateMuse({trust: this.trust, runtime: this.runtime}, muse, by); }
  delegationStatus(muses: string[]) { return delegationStatus({trust: this.trust, runtime: this.runtime}, muses); }
  taskParticipants(taskId: string) { const t = this.runtime.state().inbox?.tasks.find(x => x.id === taskId); return t ? {from: t.from, to: t.to, status: t.status} : null; }
  // Owner approvals and the owner inbox (C06, I-07); the Worker route checks the owner session and the Muse.
  ownerApprove(input: DecisionInput) { return this.connected.ownerApprove(input); }
  ownerInbox(muses: string[]) { return this.connected.ownerInbox(muses); }
  ownerLocation() { return this.connected.ownerLocation(); }
  setOwnerLocation(input: unknown) { return this.connected.setOwnerLocation(input); }
  ownerNotifications(detailFor: string[]) { return this.connected.notifications(detailFor); }
  getClaim(agent: string): ClaimRecord | null {
    const r = this.ctx.storage.sql.exec('SELECT record FROM claims WHERE agent = ?', agent).toArray()[0];
    return r ? JSON.parse(String(r.record)) : null;
  }
  /** Worker-internal: the token is used for re-checks inside the Worker and never sent to clients. */
  claimToken(agent: string): string | null {
    const r = this.ctx.storage.sql.exec('SELECT token FROM claims WHERE agent = ?', agent).toArray()[0];
    return r?.token ? String(r.token) : null;
  }
  setClaim(agent: string, record: ClaimRecord, token?: string | null) {
    // A machine-verified claim is never downgraded by an owner-direct submission.
    const prev = this.getClaim(agent);
    if (prev?.machineVerified && record.path === 'owner_direct') return prev;
    this.ctx.storage.sql.exec('INSERT INTO claims (agent, record, token) VALUES (?, ?, ?) ON CONFLICT(agent) DO UPDATE SET record = excluded.record, token = COALESCE(excluded.token, claims.token)', agent, JSON.stringify(record), token ?? null);
    return record;
  }
}
