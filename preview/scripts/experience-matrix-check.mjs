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
const exps = ['EXP-ENTRY', 'EXP-WORLD', 'EXP-IDENTITY', 'EXP-REWARD', 'EXP-MEETUP', 'EXP-LOCATION', 'EXP-REPLAY', 'EXP-COMMS'];
const missingExp = exps.filter(e => !doc.includes(`| ${e} |`));
failures += missingExp.length;
console.log(`experiences: ${exps.length - missingExp.length}/${exps.length}${missingExp.length ? ' missing ' + missingExp.join(', ') : ''}`);
if (failures) { console.error(`FAIL: ${failures} problem(s)`); process.exit(1); }
console.log('PASS: matrix ids match the source catalogs');
