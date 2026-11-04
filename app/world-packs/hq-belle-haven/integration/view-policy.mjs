import geography from './fixtures/app/assets/geography.json' with {type:'json'};
// The ordinary live entry in main bd6d9d5 opens near the commons, not in story overview.
// Integration tests execute the exact upstream initial-camera expression to catch drift.
export const LIVE_ENTRY_VIEW=Object.freeze({zoom:21.2,pitch:54,bearing:geography.cameraBearingDeg});
export function viewFor(mode='entry'){
  return mode==='overview'?{center:geography.commons,zoom:16,pitch:45,bearing:geography.cameraBearingDeg}:{center:geography.commons,...LIVE_ENTRY_VIEW};
}
