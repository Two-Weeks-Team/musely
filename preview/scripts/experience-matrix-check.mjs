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
  const beatList = l.match(/runs via beats ([a-z_, ]+?)(?: ;[^|]*)? \|/);
  if (beatList) for (const b of beatList[1].split(',').map(x => x.trim()).filter(Boolean)) if (!source.beat.includes(b)) { badRefs++; console.log('  unknown beat in action row: ' + b); }
}
failures += dupActions.length + badRefs;
console.log(`actions: ${actionIds.length} rows, duplicates ${dupActions.length}, unknown references ${badRefs}`);
const exps = ['EXP-ENTRY', 'EXP-WORLD', 'EXP-IDENTITY', 'EXP-REWARD', 'EXP-MEETUP', 'EXP-LOCATION', 'EXP-REPLAY', 'EXP-COMMS'];
const missingExp = exps.filter(e => !doc.includes(`| ${e} |`));
failures += missingExp.length;
console.log(`experiences: ${exps.length - missingExp.length}/${exps.length}${missingExp.length ? ' missing ' + missingExp.join(', ') : ''}`);
// P-04: traceability (section 9) and open decisions (section 10).
const roadmap = JSON.parse(readFileSync(new URL('../../docs/roadmap/execution-tasks.json', import.meta.url)));
const taskIds = new Set((roadmap.tasks ?? roadmap).map(t => t.id));
const section = n => { const i = doc.indexOf(`\n## ${n}.`); if (i < 0) return ''; const j = doc.indexOf('\n## ', i + 1); return doc.slice(i, j < 0 ? undefined : j); };
const cells = l => l.split('|').slice(1, -1).map(c => c.trim());
const taskRefs = t => (t.match(/\b[IDPG]-\d{2}[AB]?\b/g) ?? []);
const traceRows = section(9).split('\n').filter(l => /^\| (EXP-|AUTONOMY|OPS-)/.test(l)).map(cells);
let traceFail = 0; const traceNote = m => { traceFail++; console.log('  ' + m); };
const reachedS2 = new Set(), reachedS3 = new Set();
for (const [req, , primary, contrib, s3] of traceRows) {
  const p = taskRefs(primary);
  if (p.length !== 1 || !p[0].startsWith('I-')) traceNote(`${req}: primary S2 owner must be exactly one I-* task (got "${primary}")`);
  for (const t of [...p, ...taskRefs(contrib), ...taskRefs(s3)]) if (!taskIds.has(t)) traceNote(`${req}: unknown task ${t}`);
  if (!taskRefs(s3).some(t => t.startsWith('D-'))) traceNote(`${req}: no S3 verification task`);
  [...p, ...taskRefs(contrib)].forEach(t => reachedS2.add(t)); taskRefs(s3).forEach(t => reachedS3.add(t));
  const expRow = doc.split('\n').map(cells).find(c => c[0] === req && c[2] === req);
  if (expRow) {
    const rowTasks = taskRefs(expRow[11]).filter(t => t.startsWith('I-'));
    if (!rowTasks.includes(p[0])) traceNote(`${req}: primary ${p[0]} not in the experience row's ownerTask (${expRow[11]})`);
    for (const t of rowTasks) if (![...p, ...taskRefs(contrib)].includes(t)) traceNote(`${req}: ${t} in the experience row but not in traceability`);
  }
}
for (const e of exps) if (!traceRows.some(r => r[0] === e)) traceNote(`${e}: missing from traceability`);
for (const t of taskIds) { if (t.startsWith('I-') && !reachedS2.has(t)) traceNote(`S2 task ${t} reached by no requirement`); if (t.startsWith('D-') && !reachedS3.has(t)) traceNote(`S3 task ${t} reached by no requirement`); }
const decisions = section(10).split('\n').filter(l => /^\| DEC-\d+/.test(l)).map(cells);
for (const [id, q, owner, release] of decisions) { if (!taskRefs(owner).length || !taskIds.has(taskRefs(owner)[0])) traceNote(`${id}: owner must be a task id (got "${owner}")`); if (!release || release.length < 10) traceNote(`${id}: no release condition`); }
if (new Set(decisions.map(d => d[0])).size !== decisions.length) traceNote('duplicate decision ids');
failures += traceFail;
console.log(`traceability: ${traceRows.length} requirements, S2 tasks reached ${reachedS2.size}/${[...taskIds].filter(t => t.startsWith('I-')).length}, S3 tasks reached ${reachedS3.size}/${[...taskIds].filter(t => t.startsWith('D-')).length}, decisions ${decisions.length}, problems ${traceFail}`);
if (failures) { console.error(`FAIL: ${failures} problem(s)`); process.exit(1); }
console.log('PASS: matrix ids match the source catalogs');
