/** Resident-only model contract. Legacy visitor/spotlight schemas and replay fixtures stay unchanged. */
import {OUTPUT_SCHEMAS,buildMessages,checkOutput,schemaViolation,type ActionInput} from './actions.ts';
import {withResidentContext,type ResidentContext} from './resident-life-context.ts';
const legacy=OUTPUT_SCHEMAS.spotlight as {type:string;json_schema:{name:string;strict:boolean;schema:{type:string;additionalProperties:boolean;properties:Record<string,unknown>;required:string[]}}};
export const RESIDENT_ACTIVITY_SCHEMA={type:'json_schema',json_schema:{name:'resident_next_activity',strict:true,schema:{...legacy.json_schema.schema,
 properties:{...legacy.json_schema.schema.properties,duration_minutes:{type:'number',minimum:5,maximum:60}},required:[...legacy.json_schema.schema.required,'duration_minutes']}}};
export type ResidentActivityOutput={freedom:'where'|'who'|'offer'|'plan';decision:string;target_place:string;target_agent:string;offer_item:string;want_item:string;public_reason:string;line:string;duration_minutes:number};
export function checkActivityOutput(input:ActionInput,out:unknown):string|null {
 const problem=schemaViolation(RESIDENT_ACTIVITY_SCHEMA.json_schema.schema,out);if(problem)return problem;
 const o=out as ResidentActivityOutput;
 if(!Number.isFinite(o.duration_minutes)||o.duration_minutes<5||o.duration_minutes>60)return 'stay duration out of range';
 const {duration_minutes,...decision}=o;void duration_minutes;
 return checkOutput('spotlight',{...input,freedom:o.freedom} as ActionInput,decision);
}
export function activityMessages(input:ActionInput,context:ResidentContext|null):unknown[]{
 return withResidentContext([...buildMessages('spotlight',input),{role:'user',content:JSON.stringify({available_activities:(input as ActionInput&{activities?:unknown[]}).activities??[]})},{role:'system',content:'Your previous activity has finished. Choose exactly one next action for yourself from where, who, offer, or plan. You are not restricted to the spotlight freedom in the public input. For a stay at your current place choose an available_activities id as decision (or rest) and duration_minutes from 5 to 60; movement lasts until its real arrival ETA instead of this number. Do not change your activity just because another tick passed. You may keep resting, visit a place, greet a peer, or propose an exchange; no partner or outcome is required. An immediate reply is separate and does not cancel your current activity. Other Muses decide for themselves. Only existing public places, actors and held items are valid. All existing consent, claim, travel and item rules apply.'}],context);
}
