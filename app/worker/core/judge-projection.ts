/** Exact recipient-only projection. No private task content, approval, reason or message object is spread. */
import {JUDGE_MUSE} from '../../src/engine/judge-muse.ts';
import type {WorldState} from '../../src/engine/world.ts';
import type {TxSql} from './world-runtime.ts';
const LIMIT=50;
const time=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const text=(v:unknown):v is string=>typeof v==='string';
const nullable=(v:unknown):v is string|null=>v===null||text(v);
export function judgeInbox(sql:Pick<TxSql,'exec'>,world:WorldState){
 // Scope in SQL before loading any text; follow the public event policy, not kind alone.
 const rows=sql.exec("SELECT id,at,muse,kind,line,source FROM events WHERE other=? AND muse != ? AND line IS NOT NULL AND (kind='encounter_reply' OR (kind='greet' AND json_extract(data,'$.public')=1)) ORDER BY seq DESC LIMIT ?",JUDGE_MUSE.id,JUDGE_MUSE.id,LIMIT).toArray();
 const greetings=rows.filter(r=>text(r.id)&&time(r.at)&&text(r.muse)&&text(r.line)&&['greet','encounter_reply'].includes(String(r.kind))&&['live','rule','scripted','replay'].includes(String(r.source))).map(r=>({id:r.id as string,at:r.at as number,from:r.muse as string,kind:r.kind as 'greet'|'encounter_reply',line:r.line as string,source:r.source as 'live'|'rule'|'scripted'|'replay'}));
 const proposals=(world.inbox?.tasks??[]).filter(t=>
  // Only received proposals, including a received counteroffer, never our outgoing original offer.
  (t.to===JUDGE_MUSE.id&&t.from!==JUDGE_MUSE.id||t.kind==='trade'&&t.awaiting===JUDGE_MUSE.id&&t.offer?.by!==JUDGE_MUSE.id&&t.from===JUDGE_MUSE.id)&&
  ['trade','meetup','help'].includes(t.kind)&&['pending','completed','rejected','expired','failed','cancelled'].includes(t.status)&&text(t.id)&&text(t.from)&&time(t.createdAt)&&time(t.deadline)
 ).slice(-LIMIT).reverse().map(t=>({id:t.id,kind:t.kind,from:t.from===JUDGE_MUSE.id?t.offer!.by:t.from,status:t.status,createdAt:t.createdAt,deadline:t.deadline,
  offer:t.kind==='trade'&&t.offer&&text(t.offer.give)&&text(t.offer.want)?{give:t.offer.give,want:t.offer.want}:null}));
 return{muse:JUDGE_MUSE.id,greetings,proposals,limit:LIMIT};
}
export function judgeNotifications(world:WorldState){
 const summaries={meetup_candidate:'A meetup proposal is waiting.',trade_completed:'A trade completed.',blocked:'A request was blocked.'} as const;
 const notifications=(world.inbox?.notifications??[]).filter(n=>n.muse===JUDGE_MUSE.id&&Object.hasOwn(summaries,n.kind)&&text(n.id)&&time(n.at)&&nullable(n.other)&&nullable(n.ref)).slice(-LIMIT).reverse().map(n=>({id:n.id,kind:n.kind,at:n.at,line:summaries[n.kind],other:n.other,ref:n.ref}));
 return{muse:JUDGE_MUSE.id,notifications,limit:LIMIT};
}
