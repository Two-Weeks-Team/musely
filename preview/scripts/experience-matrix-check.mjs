// P-01 check: every catalog id in docs/EXPERIENCE_MATRIX.md matches the source catalogs, no duplicates, no gaps.
// Run from preview/: node scripts/experience-matrix-check.mjs
import {readFileSync} from 'node:fs';
const {ITEMS} = await import('../src/engine/items.ts');
const {BEATS} = await import('../src/engine/beats.ts');
const {PLACES} = await import('../src/engine/places.ts');
const manifest = JSON.parse(readFileSync(new URL('../character-kit/runtime/animations/manifest.json', import.meta.url)));
const rawClips = manifest.clips ?? manifest;
const clips = Array.isArray(rawClips) ? rawClips.map(c => c.name ?? c.id ?? c) : Object.keys(rawClips);

const doc = readFileSync(new URL('../docs/EXPERIENCE_MATRIX.md', import.meta.url), 'utf8');
const ids = [...doc.matchAll(/\| (item|beat|clip|place):([^ |]+) \|/g)].map(m => [m[1], m[2]]);
const source = {item: ITEMS.map(i => i.id), beat: BEATS.map(b => b.id), clip: clips, place: PLACES.map(p => p.id)};

let failures = 0;
for (const kind of Object.keys(source)) {
  const inDoc = ids.filter(([k]) => k === kind).map(([, id]) => id);
  const dup = inDoc.filter((id, i) => inDoc.indexOf(id) !== i);
  const missing = source[kind].filter(id => !inDoc.includes(id));
  const extra = inDoc.filter(id => !source[kind].includes(id));
  failures += dup.length + missing.length + extra.length;
  console.log(`${kind}: source ${source[kind].length}, matrix ${inDoc.length}, duplicates ${dup.length}, missing ${missing.length}, extra ${extra.length}`);
  for (const [label, list] of [['duplicate', dup], ['missing', missing], ['extra', extra]]) if (list.length) console.log(`  ${label}: ${list.join(', ')}`);
}
// Meaningful actions (direction 10): every row maps to clips that exist and beats that exist, or is planned.
const actionRows = doc.split('\n').filter(l => /\| action:[a-z_]+ \|/.test(l));
const actionIds = actionRows.map(l => l.match(/\| action:([a-z_]+) \|/)[1]);
const dupActions = actionIds.filter((id, i) => actionIds.indexOf(id) !== i);
let badRefs = 0;
for (const l of actionRows) {
  for (const [, c] of l.matchAll(/clip:([a-z_]+)/g)) if (!clips.includes(c)) { badRefs++; console.log('  unknown clip in action row: ' + c); }
  const beatList = l.match(/; beats ([a-z_, ]+?)(?: ;[^|]*)? \|/);
  if (beatList) for (const b of beatList[1].split(',').map(x => x.trim()).filter(Boolean)) if (!source.beat.includes(b)) { badRefs++; console.log('  unknown beat in action row: ' + b); }
}
failures += dupActions.length + badRefs;
console.log(`actions: ${actionIds.length} rows, duplicates ${dupActions.length}, unknown references ${badRefs}`);
const exps = ['EXP-ENTRY', 'EXP-WORLD', 'EXP-IDENTITY', 'EXP-REWARD', 'EXP-MEETUP', 'EXP-LOCATION', 'EXP-REPLAY', 'EXP-COMMS'];
const missingExp = exps.filter(e => !doc.includes(`| ${e} |`));
failures += missingExp.length;
console.log(`experiences: ${exps.length - missingExp.length}/${exps.length}${missingExp.length ? ' missing ' + missingExp.join(', ') : ''}`);
if (failures) { console.error(`FAIL: ${failures} problem(s)`); process.exit(1); }
console.log('PASS: matrix ids match the source catalogs');
