/** Optional #132 actor catalogue capability, never ownership or personal authority. */
import * as harness from '../../src/engine/harness.ts';
type Catalogue = {hasActorHarness?:(id:string)=>boolean;harnessRoleId?:(id:string)=>string};
const catalogue=harness as typeof harness & Catalogue;
export function hasResidentHarness(id:string):boolean {
  return typeof catalogue.hasActorHarness==='function'?catalogue.hasActorHarness(id):harness.HARNESS_IDS.includes(id);
}
export function residentHarnessRole(id:string):string|null {
  if(!hasResidentHarness(id))return null;
  const role=typeof catalogue.harnessRoleId==='function'?catalogue.harnessRoleId(id):id;
  return harness.HARNESS_IDS.includes(role)?role:null;
}
