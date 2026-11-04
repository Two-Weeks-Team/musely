import type {ResidentContext} from './resident-life-context.ts';

/** Recovery-mode projection of an already authorized, validated NPC context.
 * The caller keeps the original store and uses the existing untrusted-data wrapper.
 * Routine/relationship priority comes from that caller; every pending obligation survives.
 * Older memories/facts and all interpretations are omitted, never replaced with invented text.
 */
export function compactResidentContext(context:ResidentContext|null):ResidentContext|null {
 if(context===null)return null;
 const relationships=context.relationships?.slice(0,2).map(({other,facts})=>({other,
  facts:[...facts].sort((a,b)=>b.at-a.at||a.eventId.localeCompare(b.eventId)).slice(0,1)
   .map(({eventId,kind,at,source})=>({eventId,kind,at,source})),
 }));
 return {
  schema:context.schema,residentId:context.residentId,revision:context.revision,publicGoal:context.publicGoal,
  routine:context.routine.slice(0,2).map(({hour,place})=>({hour,place})),
  pendingPromises:context.pendingPromises.map(({id,other,place,dueAt,status,evidenceId})=>({id,other,place,dueAt,status,evidenceId})),
  executedMemories:[...context.executedMemories].sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id)).slice(0,2)
   .map(({id,at,subject,publicSummary,source,evidenceId})=>({id,at,subject,publicSummary:publicSummary.slice(0,100),source,evidenceId})),
  ...(relationships?{relationships}:{}),
 };
}
