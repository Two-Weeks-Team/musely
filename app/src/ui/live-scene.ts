import {appearanceKey,resolveAppearance,type AppearanceId} from '../character-kit/appearance.ts';
import {uiText,catalogText,inventoryText,activityStatus} from './i18n.ts';
import type {CampfireScenePort} from '../../world-packs/campfire/scene-port.mjs';
// I-09: read-only server snapshot/event → existing rig, props, labels and four small effects.
// The scripted eight-character scene stays intact; live mode reuses its matching IDs and adds Ember/Copper.
import * as T from 'three';
import type {RecordedFrame} from '../replay/player.ts';
import {SceneProjection, frameSource} from './recorded-scene.ts';
import {layoutLiveLabels,type LabelCandidate,type LabelBox} from './live-label-layout.ts';
import {liveActivity,recentLiveSpeech,speechDisplay} from './live-display.ts';
import {placeLiveBubble,type ScreenBox} from './bubble-layout.ts';
import {frameSpeech} from './speech-recipient.ts';
import {loadMuseLight, type MaterialLibrary} from '../character-kit/MaterialLibrary.ts';
import type {MuseActor} from '../character-kit/MuseActor.ts';
import {MUSE_VARIANTS, propsUrl, attachmentUrl, lodUrl, type MuseVariantId} from '../character-kit/catalog.ts';
import {resolveMuse, withSnapshotProfiles} from './personal-profile.ts';
import {chooseLods} from '../character-kit/residents.ts';
import {surfaceHeightAt} from '../surfaces.ts';
import {UPPER_BONES, inventorySummary, museName, ownerOf, type ActorFrame, type FxKind, type LiveWorld, type LiveEvent} from './live-scene-core.ts';

type Host = {scene: T.Scene; actors: MuseActor[] | null | undefined; muses: T.Object3D[]; shadows: T.Mesh[];
  selection: T.Object3D; campfireVisual?: CampfireScenePort; library: MaterialLibrary | null | undefined; shadowTexture: T.Texture | null; ambient(t: number): void};
type Entry = {id: string; actor: MuseActor; shadow: T.Mesh; extra: boolean; label: HTMLElement | null};
type Point = {x: number; y: number};
const FX: Record<FxKind, number> = {teleport: 0x8fb8ff, item: 0xffd27d, stamp: 0x92d7b3, trade_lock: 0xe0b2f7};

export function makeLiveScene(host: Host, project: (p: T.Vector3) => Point = () => ({x: -100, y: -100})) {
  const store = new SceneProjection();
  let projection = store.projection;
  // Receipt time comes from the successful HTTP read, including cached startup/pause hand-offs.
  let liveObservedAt: number | undefined;
  const entries = new Map<string, Entry>(), personal = new Map<string, Entry>(), errors: string[] = [];
  const loading = new Map<string, {variant: MuseVariantId; key:string; token: object; promise: Promise<void>}>();
  let active = false, disposed = false, frames = new Map<string, ActorFrame>(), now = 0, selected = '00-jolly';
  let lods = MUSE_VARIANTS.map(() => 2 as 0 | 1 | 2);
  const root = typeof document === 'undefined' ? null : document.createElement('div');
  if (root) {root.id = 'live-muse-labels'; root.setAttribute('aria-hidden', 'true'); document.body.append(root);}
  const speechRoot=typeof document==='undefined'?null:document.createElement('div');if(speechRoot){speechRoot.id='live-speech-cards';document.body.append(speechRoot);}
  const speechCards=Array.from({length:2},()=>{if(!speechRoot)return null;const card=document.createElement('div');card.className='speech-bubble live-speech-card';card.hidden=true;const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),leader=document.createElementNS(svg.namespaceURI,'path');svg.classList.add('live-speech-leader');svg.append(leader);speechRoot.append(svg,card);return {card,svg,leader};});
  const labelSizes=new WeakMap<HTMLElement,{key:string;width:number;height:number}>();
  function add(actor: MuseActor, shadow: T.Mesh, extra: boolean, id: string = actor.variant, isPersonal = false) {
    let label: HTMLElement | null = null;
    if (root) {label = document.createElement('div'); label.className = 'live-muse-label'; label.dataset.museId = id; label.hidden = true; root.append(label);}
    (isPersonal ? personal : entries).set(id, {id, actor, shadow, extra, label});
    actor.root.userData.museId = id; actor.root.userData.liveExtra = extra;
    if (extra) {host.scene.add(actor.root, shadow); actor.root.visible = shadow.visible = active;}
  }
  for (const [i, actor] of (host.actors ?? []).entries()) add(actor, host.shadows[i], false);
  const effects = new Map<FxKind, T.InstancedMesh>();
  for (const kind of Object.keys(FX) as FxKind[]) {
    const color = FX[kind];
    const mesh = new T.InstancedMesh(new T.RingGeometry(.28, .34, 24), new T.MeshBasicMaterial({color, transparent: true, opacity: .65, side: T.DoubleSide, depthWrite: false}), 10);
    mesh.name = 'LiveEffect_' + kind; mesh.frustumCulled = false; mesh.visible = false; mesh.count = 0; host.scene.add(mesh); effects.set(kind, mesh);
  }
  const legacyReady = Promise.all(MUSE_VARIANTS.filter(v => !entries.has(v.id)).map(async v => {
    if (!host.library) {errors.push(uiText`${v.id}: character kit unavailable`); return;}
    try {
      const loaded = await loadMuseLight(v.id, host.library);
      if (disposed) {loaded.actor.dispose(); return;}
      const shadow = new T.Mesh(new T.PlaneGeometry(1, .8), new T.MeshBasicMaterial({map: host.shadowTexture, transparent: true, depthWrite: false}));
      shadow.rotation.x = -Math.PI / 2; add(loaded.actor, shadow, true);
      const e=entries.get(v.id)!;await upgradeEntry(e,v.id,()=>!disposed&&entries.get(v.id)===e);
    } catch (e) {errors.push(`${v.id}: ${String(e)}`);}
  }));
  // Carried props are needed for live events, so request their shared 145 KB file without waiting for all full LODs.
  if (host.library) void host.library.load(propsUrl(host.library.base)).then(g => {if (!disposed) for (const {actor} of entries.values()) actor.addProps(g);}).catch(e => errors.push(uiText('props: ') + String(e)));
  void legacyReady.then(() => {if (!disposed && host.library) void host.library.load(propsUrl(host.library.base)).then(g => {if (!disposed) for (const {actor} of entries.values()) actor.addProps(g);}).catch(() => {});});

  const allEntries = () => [...entries.values(), ...personal.values()];
  function releasePersonal(id: string) {
    const e = personal.get(id); if (!e) return;
    personal.delete(id); e.label?.remove(); e.actor.dispose(); e.shadow.removeFromParent();
    e.shadow.geometry.dispose(); (e.shadow.material as T.Material).dispose();
  }
  function wanted(id: string, variant: MuseVariantId,key?:string) {
    const m = projection.world?.muses.find(m => m.id === id), p = m ? resolveMuse(m) : null;
    return !disposed && (p?.kind === 'personal'||p?.kind === 'resident') && p.appearanceId === variant && (entries.get(id)?.actor.variant !== variant||typeof p?.profile?.appearanceId==='object')&&(key===undefined||appearanceKey(p?.appearance??variant)===key);
  }
  async function upgradeEntry(e: Entry, variant: MuseVariantId, current: () => boolean) {
    if (!host.library) return;
    // The library owns shared geometry/materials. Apply each late resource only to the still-current instance.
    for (const step of ['attachment', 1, 0, 'props'] as const) {
      try {
        const deco=resolveAppearance(e.actor.appearance).deco;const url = step === 'attachment' ? (deco==='none'?null:attachmentUrl(deco,host.library.base)) : step === 'props' ? propsUrl(host.library.base) : lodUrl(step,host.library.base);
        if (!url || !current()) continue;
        const gltf = await host.library.load(url); if (!current()) return;
        if (step === 'attachment') e.actor.addAttachment(gltf); else if (step === 'props') e.actor.addProps(gltf); else e.actor.addLod(gltf,step);
      } catch { if (current()) errors.push(e.id + ': character detail unavailable'); }
    }
  }
  function reconcile() {
    if (disposed) return;
    for (const [id,e] of personal) if (!wanted(id,e.actor.variant,appearanceKey(e.actor.appearance))) releasePersonal(id);
    for (const [id,p] of loading) if (!wanted(id,p.variant,p.key)) loading.delete(id);
    for (const m of projection.world?.muses ?? []) {
      const p = resolveMuse(m), variant = p.appearanceId;
      const appearance=p.appearance??variant,key=appearance?appearanceKey(appearance):'';if (!variant||!appearance||!wanted(m.id,variant)||personal.get(m.id)?.actor.variant===variant&&appearanceKey(personal.get(m.id)!.actor.appearance)===appearanceKey(appearance)||loading.get(m.id)?.key===key)continue;
      if (personal.has(m.id)) releasePersonal(m.id);
      if (!host.library) continue; // Honest card/pin projection still works when the kit is unavailable.
      const token = {}, id = m.id;
      const promise = (async () => {
        try {
          const loaded = await loadMuseLight(variant,host.library!,appearance);
          if (loading.get(id)?.token !== token || !wanted(id,variant,key)) {loaded.actor.dispose(); return;}
          const shadow = new T.Mesh(new T.PlaneGeometry(1,.8), new T.MeshBasicMaterial({map:host.shadowTexture,transparent:true,depthWrite:false}));
          shadow.rotation.x = -Math.PI/2; add(loaded.actor,shadow,true,id,true);
          const e=personal.get(id)!;await upgradeEntry(e,variant,()=>wanted(id,variant,key)&&personal.get(id)===e);
        } catch {if (loading.get(id)?.token === token && wanted(id,variant,key)) errors.push(id + uiText(': character kit unavailable'));}
        finally {if (loading.get(id)?.token === token) loading.delete(id);}
      })();
      loading.set(id,{variant,key,token,promise});
    }
  }
  const shadowVisible = (e: Entry, visible: boolean) => {e.shadow.userData.instanceHidden = !visible;if (!e.shadow.userData.instanced) e.shadow.visible = visible;};
  function setActive(value: boolean) {
    if(disposed)return;
    const leavingLive = active && !value;
    active = value;
    if(!value) host.campfireVisual?.setWorld(null);
    if (!host.actors?.length) {for (const node of host.muses) node.visible = !value;for (const shadow of host.shadows) {shadow.userData.instanceHidden = value;if (!shadow.userData.instanced) shadow.visible = !value;}}
    if (root) root.hidden = !value;if(speechRoot)speechRoot.hidden=!value;
    for (const e of allEntries()) {
      const overridden = entries.get(e.id) === e && personal.has(e.id);
      const visible = value ? !overridden && !!projection.world?.muses.some(m => m.id === e.id) : !e.extra; e.actor.root.visible = visible; shadowVisible(e, visible);
      // Preview cues own their hold lifetime through endCues, including a hold begun before this frame leaves live mode.
      if (!value) {if (leavingLive) e.actor.carry(null); if (e.label) e.label.hidden = true;}
    }
    if (!value) for (const mesh of [...effects.values()]) mesh.visible = false;
  }
  function accept(world: LiveWorld, events: readonly LiveEvent[], observedAt = world.lastTickAt) {
    if(disposed||!store.accept(withSnapshotProfiles(world,world),events))return false;
    liveObservedAt=observedAt;projection=store.projection;reconcile();return true;
  }
  function setRecordedFrame(frame: RecordedFrame | null) {if (disposed) return; store.setRecordedFrame(frame); projection = store.projection; if(frame&&projection.world)projection.world=withSnapshotProfiles(projection.world,frame.publicState);reconcile(); if (root) root.dataset.replay = String(store.replay);}
  const sourceOf = (id: string) => frameSource(projection, frames.get(id), id);
  function update(at: number, selectedId = selected, ownId:string|null=null) {
    now = at; selected = selectedId;
    if (disposed || !active) return;
    if (!projection.world) {
      // Returning from replay while offline must not leave recorded people or sparks in the live view.
      frames.clear();host.campfireVisual?.setWorld(null);host.selection.visible=false;
      for(const e of allEntries()){e.actor.root.visible=false;shadowVisible(e,false);if(e.label)e.label.hidden=true;}
      for(const mesh of effects.values()){mesh.visible=false;mesh.count=0;}
      for(const speech of speechCards)if(speech){speech.card.hidden=true;speech.svg.style.display='none';}host.ambient(at / 1000);return;
    }
    host.campfireVisual?.setWorld(projection.world, store.replay ? store.recordedAt ?? at : liveObservedAt);
    frames = projection.frames(at);
    const labelCandidates:LabelCandidate[]=[],labelNodes=new Map<string,HTMLElement>(),heads=new Map<string,Point>();
    const groupSizes=new Map<string,number>();
    for(const f of frames.values())if(!f.travel)groupSizes.set(f.place,(groupSizes.get(f.place)??0)+1);
    for (const e of allEntries()) {
      const f = entries.get(e.id) === e && personal.has(e.id) ? undefined : frames.get(e.id), actor = e.actor;
      actor.root.visible = !!f; shadowVisible(e, !!f);
      if (!f) {if (e.label) e.label.hidden = true; continue;}
      if (f.upper) {if (!actor.setBlend(f.clip, f.upper, UPPER_BONES)) actor.setAction(f.clip);}
      else actor.setAction(actor.hasAction(f.clip) ? f.clip : 'idle_breathe');
      actor.carry(f.carry);
      actor.setExpression(f.line ? 'Listening' : f.clip === 'celebrate' ? 'Delight' : f.clip === 'think' ? 'Thinking' : 'Neutral');
      const y = surfaceHeightAt(f.x, f.z) + .006;
      actor.update(at / 1000, {x: f.x, y, z: f.z, yaw: f.yaw}, f.actionTime, f.upperTime);
      if (f.carry && !actor.carryShown()) {f.visual = 'fallback'; f.fallback = uiText('The shared 3D item prop is loading; shown as an item card.'); f.card ??= uiText('item (3D prop loading)');}
      e.shadow.position.set(f.x, surfaceHeightAt(f.x, f.z) + .002, f.z);
      if (e.label) {
        const p = project(new T.Vector3(f.x, y + 1.12, f.z));
        const foot = project(new T.Vector3(f.x, y, f.z));
        heads.set(e.id,p);e.label.hidden = Math.abs(foot.y-p.y)<20||p.x<0||p.y<0||p.x>innerWidth||p.y>innerHeight;
        e.label.dataset.selected=String(e.id===selectedId);
        e.label.dataset.clustered=String(!f.travel&&(groupSizes.get(f.place)??0)>1);
        e.label.dataset.clusterCount='';
        const speech=frameSpeech(f,projection.world,projection.events);
        const text=museName(f.id,projection.world)+'\n'+liveActivity(f);
        e.label.className='live-muse-label live-status-bubble';
        if(e.label.dataset.displayKey!==text){e.label.dataset.displayKey=text;const name=document.createElement('strong'),status=document.createElement('small');name.textContent=museName(f.id,projection.world);status.textContent=liveActivity(f);e.label.replaceChildren(name,status);}
        if(!e.label.hidden){
          labelNodes.set(e.id,e.label);
          labelCandidates.push({id:e.id,group:f.travel?'travel:'+e.id:f.place,groupSize:f.travel?1:groupSizes.get(f.place),x:p.x,y:p.y,width:0,height:0,selected:e.id===selectedId,speaking:!!speech});
        }
        e.label.dataset.version = String(projection.world.version ?? projection.world.tick);
        e.label.dataset.source = sourceOf(f.id);
        e.label.dataset.replay = String(store.replay);
        e.label.dataset.visual = f.visual;
        e.label.title = `${store.replay ? uiText('REPLAY · ') : ''}${activityStatus(f.status)}${f.fallback ? ' · ' + activityStatus(f.fallback) : ''}`;
      }
    }
    if(root){
    // Measure only when text/viewport/priority changes, then place all boxes together.
    for(const c of labelCandidates){const node=labelNodes.get(c.id)!,key=`${innerWidth}:${node.textContent}:${node.dataset.clustered}:${node.dataset.selected}`;
      let size=labelSizes.get(node);if(size?.key!==key){const rect=node.getBoundingClientRect?.();size={key,width:rect?.width||Math.min(240,innerWidth-24),height:rect?.height||36};labelSizes.set(node,size);}c.width=size.width;c.height=size.height;
    }
    const obstacles:LabelBox[]=[];
    for(const selector of ['header','footer','#muse-card','.map-tools','#loading','#network-note','#judge-entry']){const node=document.querySelector?.<HTMLElement>(selector);if(!node||node.hidden)continue;const r=node.getBoundingClientRect();if(r.width&&r.height)obstacles.push({left:r.left,top:r.top,width:r.width,height:r.height});}
    // Live speech uses the preview's candidate offsets and stays literal, including its public recipient.
    const cards=store.replay?[]:recentLiveSpeech(projection.events,projection.world,at,selectedId,ownId,50).filter(e=>labelCandidates.some(c=>c.id===e.muse)).slice(0,innerWidth<700?1:2);
    for(const [i,s]of speechCards.entries()){if(!s)continue;const event=cards[i],anchor=event?heads.get(event.muse!):null;s.card.hidden=true;s.svg.style.display='none';if(!event||!anchor)continue;const value=speechDisplay(event,projection.world),key=event.id+'|'+value.name+'|'+value.recipient+'|'+innerWidth;if(s.card.dataset.contentKey!==key){const speaker=document.createElement('span'),line=document.createElement('p'),source=document.createElement('small');speaker.className='bubble-speaker';speaker.style.color=resolveMuse(projection.world!.muses.find(m=>m.id===event.muse)!).color;speaker.textContent=value.name+(value.recipient?' → '+value.recipient:'');line.textContent=value.line;source.textContent=value.source;s.card.replaceChildren(speaker,line,source);s.card.dataset.contentKey=key;delete s.card.dataset.width;}s.card.hidden=false;s.card.style.visibility='hidden';const rect=s.card.getBoundingClientRect?.()??{width:230,height:96},box=placeLiveBubble(anchor,{width:rect.width||230,height:rect.height||96},{width:innerWidth,height:innerHeight},obstacles);if(!box){s.card.hidden=true;continue;}s.card.dataset.museId=event.muse!;s.card.dataset.source=event.source!;s.card.style.left=box.left+'px';s.card.style.top=box.top+'px';s.card.style.visibility='visible';s.svg.style.display='block';s.svg.setAttribute('viewBox',`0 0 ${innerWidth} ${innerHeight}`);s.leader.setAttribute('d',`M ${box.left+box.width/2} ${box.top+box.height} L ${anchor.x} ${anchor.y}`);obstacles.push(box);}
    const ranked=[...labelCandidates].sort((a,b)=>Number(b.id===selectedId)-Number(a.id===selectedId)||Number(b.id===ownId)-Number(a.id===ownId)||Math.hypot(a.x-innerWidth/2,a.y-innerHeight/2)-Math.hypot(b.x-innerWidth/2,b.y-innerHeight/2));
    const detailed=new Set(ranked.slice(0,8).map(c=>c.id));for(const c of ranked)if(!detailed.has(c.id)){const node=labelNodes.get(c.id)!;node.className='live-muse-dot';node.textContent='';delete node.dataset.displayKey;node.hidden=false;node.style.transform=`translate(${Math.round(c.x)}px,${Math.round(c.y)}px)`;}
    for(const p of layoutLiveLabels(labelCandidates.filter(c=>detailed.has(c.id)),{left:12,right:innerWidth-12,top:70,bottom:innerHeight-32},obstacles)){
      const node=labelNodes.get(p.id)!;node.hidden=p.hidden;node.dataset.clusterCount=p.count?`+${p.count}`:'';
      node.style.transform=`translate(${Math.round(p.left)}px,${Math.round(p.top)}px)`;
    }
    }
    const ordered = [...MUSE_VARIANTS.map(v => personal.get(v.id) ?? entries.get(v.id)), ...[...personal.values()].filter(e=>!MUSE_VARIANTS.some(v=>v.id===e.id)).sort((a,b)=>a.id.localeCompare(b.id))];
    const heights = ordered.map(e => {if (!e?.actor.root.visible) return 0; const p = e.actor.root.position; return Math.abs(project(p.clone()).y - project(p.clone().add(new T.Vector3(0, .95, 0))).y);});
    lods = chooseLods(heights, ordered.map(e=>e?.actor.wanted??2), [ordered.findIndex(e=>e?.id===selectedId)]);
    ordered.forEach((e, i) => e?.actor.setLod(lods[i]));
    const chosen = frames.get(selectedId);
    host.selection.visible = !!chosen;
    if (chosen) host.selection.position.set(chosen.x, surfaceHeightAt(chosen.x, chosen.z) + .004, chosen.z);
    for (const [kind, mesh] of [...effects]) {
      let n = 0;
      for (const f of frames.values()) for (const fx of f.effects) if (fx.kind === kind && n < 10) {
        const s = .75 + fx.progress * 1.6, y = surfaceHeightAt(f.x, f.z) + .02;
        mesh.setMatrixAt(n++, new T.Matrix4().compose(new T.Vector3(f.x, y, f.z), new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2), new T.Vector3(s, s, s)));
      }
      mesh.count = n; mesh.visible = n > 0; mesh.instanceMatrix.needsUpdate = true;
    }
    host.ambient(at / 1000);
  }
  function getMetrics() {
    return {active, replay: store.replay, liveVersion: store.live.world?.version ?? null, recordedAt: store.recordedAt, worldId: projection.world?.worldId ?? null, version: projection.world?.version ?? null, at: now, errors: [...errors],
      effects: Object.fromEntries([...effects].map(([k, m]) => [k, m.visible ? m.count : 0])),
      muses: (projection.world?.muses ?? []).map(m => {const e = personal.get(m.id) ?? entries.get(m.id), f = frames.get(m.id); return {id: m.id, name: museName(m.id,projection.world), variant: e?.actor.variant ?? null, owner: ownerOf(m.id,m), inventory: [...m.inventory], inventorySummary: inventorySummary(m.inventory).text,
        version: projection.world?.version ?? null, rootId: e?.actor.root.uuid ?? null, position: e?.actor.root.position.toArray() ?? null, floorY: f ? surfaceHeightAt(f.x, f.z) + .006 : null,
        source: sourceOf(m.id), frame: f ?? null, rendered: !!e?.actor.root.visible, lod: e?.actor.lod ?? null, loadedLods: e ? [...e.actor.loaded].sort() : [], propsLoaded: e?.actor.propsLoaded ?? false, carryShown: e?.actor.carryShown() ?? false};})};
  }
  function dispose() {
    if(disposed)return;setActive(false); disposed = true; loading.clear(); root?.remove();speechRoot?.remove();
    try {host.campfireVisual?.disable();}
    finally {
      for(const id of [...personal.keys()])releasePersonal(id);
      for (const e of entries.values()) if (e.extra) {e.actor.dispose(); e.shadow.removeFromParent(); e.shadow.geometry.dispose(); (e.shadow.material as T.Material).dispose();}
      for (const mesh of [...effects.values()]) {mesh.removeFromParent(); mesh.geometry.dispose(); (mesh.material as T.Material).dispose();}
    }
  }
  return {get ready(){return Promise.all([legacyReady,...[...loading.values()].map(p=>p.promise)]);}, accept, setRecordedFrame, setActive, update, getMetrics, dispose, get projection() {return projection;}, get liveProjection() {return store.live;}, get frames() {return frames;}, get active() {return active;}};
}

