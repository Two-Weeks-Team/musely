/** Display-only boundary. Never fall back to a resident's persona, tools or authority.
 * Future registry public-profile wiring may replace the neutral label; IDs remain identity.
 */
import {ACTOR_IDS,hasActorHarness,harnessById} from './harness.ts';
export function actorLabel(id:string):string {
  return hasActorHarness(id)?harnessById(id).name:'Visiting Muse';
}
export function actorRole(id:string):string|null {
  return hasActorHarness(id)?harnessById(id).role:null;
}
/** Display aliases identify known residents only. Unknown labels are not lookup aliases. */
export function knownActorNamed(name:string):string|null {
  return ACTOR_IDS.find(id=>harnessById(id).name.toLowerCase()===name.trim().toLowerCase()) ?? null;
}
