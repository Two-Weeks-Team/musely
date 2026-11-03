/** Display-only boundary. Never fall back to a resident's persona, tools or authority.
 * Future registry public-profile wiring may replace the neutral label; IDs remain identity.
 */
import {HARNESSES} from './harness.ts';
export function actorLabel(id:string):string {
  return HARNESSES.find(h=>h.id===id)?.name ?? 'Visiting Muse';
}
export function actorRole(id:string):string|null {
  return HARNESSES.find(h=>h.id===id)?.role ?? null;
}
/** Display aliases identify known residents only. Unknown labels are not lookup aliases. */
export function knownActorNamed(name:string):string|null {
  return HARNESSES.find(h=>h.name.toLowerCase()===name.trim().toLowerCase())?.id ?? null;
}
